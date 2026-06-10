import 'dotenv/config';
import fs from 'node:fs';

const result = {
  datagov: { configured: Boolean(process.env.DATAGOV_API_KEY) },
  datamall: { configured: Boolean(process.env.DATAMALL_ACCOUNT_KEY) },
  onemap: { configured: Boolean(process.env.ONEMAP_API_KEY) },
  openrouter: {
    configured: Boolean(process.env.OPENROUTER_API_KEY),
    model: process.env.OPENROUTER_MODEL_DEV || process.env.OPENROUTER_MODEL || '',
  },
};

const quotaFile = new URL('../.provider-smoke-quota.json', import.meta.url);
const smokeQuotas = {
  datagov: { label: 'Data.gov.sg', maxCallsPerHour: 6 },
  datamall: { label: 'LTA DataMall', maxCallsPerHour: 8 },
  onemap: { label: 'OneMap', maxCallsPerHour: 8 },
  openrouter: { label: 'OpenRouter', maxCallsPerHour: 4 },
};
const quotaState = readQuotaState();

async function quotaFetch(provider, reason, url, options) {
  guardSmokeQuota(provider, reason);
  return fetch(url, options);
}

function guardSmokeQuota(provider, reason) {
  const policy = smokeQuotas[provider];
  const now = Date.now();
  const windowMs = 60 * 60_000;
  const hits = (quotaState[provider] ?? []).filter((hit) => now - hit.at < windowMs);
  if (hits.length >= policy.maxCallsPerHour) {
    const retryAfterS = Math.ceil((windowMs - (now - hits[0].at)) / 1000);
    const message = `${policy.label} smoke-test rate limit triggered for "${reason}". Blocked for about ${retryAfterS}s to protect API quota.`;
    const error = new Error(message);
    error.code = 'SMOKE_RATE_LIMIT';
    throw error;
  }
  hits.push({ at: now, reason });
  quotaState[provider] = hits;
  writeQuotaState();
}

async function smokeDataGov() {
  if (!process.env.DATAGOV_API_KEY) {
    result.datagov.status = 'not_configured';
    return;
  }
  const url = 'https://api.data.gov.sg/v1/environment/2-hour-weather-forecast';
  const response = await quotaFetch('datagov', '2-hour weather forecast smoke', url, {
    headers: {
      'x-api-key': process.env.DATAGOV_API_KEY,
      accept: 'application/json',
    },
  });
  result.datagov.httpStatus = response.status;
  if (!response.ok) {
    result.datagov.status = 'failed';
    result.datagov.error = await safeText(response);
    return;
  }
  const data = await response.json();
  result.datagov.status = 'ok';
  result.datagov.source = 'data.gov.sg 2-hour-weather-forecast';
  result.datagov.forecastAreas = data?.items?.[0]?.forecasts?.length ?? 0;
  result.datagov.apiInfo = data?.api_info?.status ?? null;
}

async function smokeOpenRouter() {
  if (!process.env.OPENROUTER_API_KEY) {
    result.openrouter.status = 'not_configured';
    return;
  }
  const modelsResponse = await quotaFetch('openrouter', 'model catalogue smoke', 'https://openrouter.ai/api/v1/models', {
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      accept: 'application/json',
    },
  });
  result.openrouter.modelsHttpStatus = modelsResponse.status;
  if (!modelsResponse.ok) {
    result.openrouter.status = 'auth_or_models_failed';
    result.openrouter.error = await safeText(modelsResponse);
    return;
  }
  const models = await modelsResponse.json();
  const ids = Array.isArray(models?.data) ? models.data.map((m) => m.id) : [];
  result.openrouter.modelCount = ids.length;
  result.openrouter.configuredModelAvailable = result.openrouter.model
    ? ids.includes(result.openrouter.model)
    : false;

  if (!result.openrouter.model) {
    result.openrouter.status = 'ok_no_model_configured';
    return;
  }
  if (!result.openrouter.configuredModelAvailable) {
    result.openrouter.status = 'auth_ok_model_not_found';
    result.openrouter.nearbyModels = ids
      .filter((id) => id.toLowerCase().includes(result.openrouter.model.toLowerCase().split('/').at(-1) ?? ''))
      .slice(0, 8);
    return;
  }

  const chatResponse = await quotaFetch('openrouter', 'chat completion smoke', 'https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'content-type': 'application/json',
      'http-referer': 'http://localhost:3000',
      'x-title': 'Kampung Kaki smoke test',
    },
    body: JSON.stringify({
      model: result.openrouter.model,
      messages: [
        {
          role: 'user',
          content: 'Reply with exactly: kampung-kaki-openrouter-ok',
        },
      ],
      max_tokens: 256,
      temperature: 0,
    }),
  });
  result.openrouter.chatHttpStatus = chatResponse.status;
  if (!chatResponse.ok) {
    result.openrouter.status = 'model_available_chat_failed';
    result.openrouter.error = await safeText(chatResponse);
    return;
  }
  const chat = await chatResponse.json();
  result.openrouter.status = 'ok';
  result.openrouter.reply = chat?.choices?.[0]?.message?.content ?? '';
}

async function smokeDataMall() {
  if (!process.env.DATAMALL_ACCOUNT_KEY) {
    result.datamall.status = 'not_configured';
    return;
  }
  const base = 'https://datamall2.mytransport.sg/ltaodataservice';
  const headers = {
    AccountKey: process.env.DATAMALL_ACCOUNT_KEY,
    accept: 'application/json',
  };
  const endpoints = [
    ['trafficIncidents', `${base}/TrafficIncidents`],
  ];
  result.datamall.endpoints = {};
  for (const [name, url] of endpoints) {
    const response = await quotaFetch('datamall', `${name} smoke`, url, { headers });
    const entry = { httpStatus: response.status };
    result.datamall.endpoints[name] = entry;
    if (!response.ok) {
      entry.status = 'failed';
      entry.error = await safeText(response);
      continue;
    }
    const data = await response.json();
    entry.status = 'ok';
    entry.count = Array.isArray(data?.value) ? data.value.length : null;
  }
  result.datamall.endpoints.trafficSpeedBands = await smokeDataMallSpeedBands(base, headers);
  const failed = Object.values(result.datamall.endpoints).filter((e) => e.status !== 'ok');
  result.datamall.status = failed.length ? 'partial_or_failed' : 'ok';
}

async function smokeDataMallSpeedBands(base, headers) {
  const candidates = [
    `${base}/v4/TrafficSpeedBands?$top=5`,
    `${base}/v3/TrafficSpeedBands?$top=5`,
    `${base}/TrafficSpeedBands?$top=5`,
  ];
  const attempts = [];
  for (const url of candidates) {
    const response = await quotaFetch('datamall', 'traffic speed bands smoke', url, { headers });
    const attempt = { url: url.replace(base, ''), httpStatus: response.status };
    attempts.push(attempt);
    if (!response.ok) {
      attempt.status = 'failed';
      attempt.error = await safeText(response);
      continue;
    }
    const data = await response.json();
    return {
      status: 'ok',
      httpStatus: response.status,
      endpoint: attempt.url,
      count: Array.isArray(data?.value) ? data.value.length : null,
      attempts,
    };
  }
  return { status: 'failed', attempts };
}

async function smokeOneMap() {
  if (!process.env.ONEMAP_API_KEY) {
    result.onemap.status = 'not_configured';
    return;
  }
  const base = 'https://www.onemap.gov.sg';
  const headers = {
    Authorization: process.env.ONEMAP_API_KEY,
    accept: 'application/json',
  };
  result.onemap.endpoints = {};

  result.onemap.endpoints.search = await oneMapJson(
    'search',
    `${base}/api/common/elastic/search?searchVal=${encodeURIComponent('Singapore General Hospital')}&returnGeom=Y&getAddrDetails=Y&pageNum=1`,
    headers,
    (data) => ({
      found: data?.found ?? null,
      first: data?.results?.[0]
        ? {
            searchVal: data.results[0].SEARCHVAL,
            postal: data.results[0].POSTAL,
            latitude: data.results[0].LATITUDE,
            longitude: data.results[0].LONGITUDE ?? data.results[0].LONGTITUDE,
          }
        : null,
    })
  );

  result.onemap.endpoints.reverseGeocode = await oneMapJson(
    'reverse geocode',
    `${base}/api/public/revgeocode?location=1.2806,103.8359&buffer=80&addressType=All`,
    headers,
    (data) => ({
      count: Array.isArray(data?.GeocodeInfo) ? data.GeocodeInfo.length : null,
      first: data?.GeocodeInfo?.[0]
        ? {
            building: data.GeocodeInfo[0].BUILDINGNAME,
            road: data.GeocodeInfo[0].ROAD,
            postal: data.GeocodeInfo[0].POSTALCODE,
          }
        : null,
    })
  );

  result.onemap.endpoints.walkRoute = await oneMapJson(
    'walk route',
    `${base}/api/public/routingsvc/route?start=1.2806,103.8359&end=1.2795,103.8345&routeType=walk`,
    headers,
    (data) => ({
      statusMessage: data?.status_message ?? null,
      totalTimeSeconds: data?.route_summary?.total_time ?? null,
      totalDistanceMetres: data?.route_summary?.total_distance ?? null,
      instructionCount: Array.isArray(data?.route_instructions) ? data.route_instructions.length : null,
    })
  );

  result.onemap.endpoints.themesInfo = await oneMapJson(
    'all themes info',
    `${base}/api/public/themesvc/getAllThemesInfo?moreInfo=Y`,
    headers,
    (data) => {
      const themes = Array.isArray(data?.Theme_Names) ? data.Theme_Names : [];
      const healthThemes = themes
        .filter((theme) => [theme.THEMENAME, theme.QUERYNAME, theme.CATEGORY].join(' ').toLowerCase().match(/health|dengue|aed|defib|clinic|hospital/))
        .slice(0, 10)
        .map((theme) => ({
          name: theme.THEMENAME,
          queryName: theme.QUERYNAME,
          category: theme.CATEGORY,
          owner: theme.THEME_OWNER,
        }));
      return { count: themes.length, healthThemes };
    }
  );

  result.onemap.endpoints.dengueTheme = await oneMapJson(
    'dengue theme retrieve',
    `${base}/api/public/themesvc/retrieveTheme?queryName=dengue_cluster&extents=1.291789,103.7796402,1.3290461,103.8726032`,
    headers,
    (data) => ({
      resultCount: Array.isArray(data?.SrchResults) ? data.SrchResults.length : null,
      featureCount: data?.SrchResults?.[0]?.FeatCount ?? null,
      themeName: data?.SrchResults?.[0]?.Theme_Name ?? null,
      firstDescription: data?.SrchResults?.[1]?.DESCRIPTION ?? null,
    })
  );

  result.onemap.endpoints.aedTheme = await oneMapJson(
    'AED theme retrieve',
    `${base}/api/public/themesvc/retrieveTheme?queryName=aed_locations&extents=1.2700,103.8300,1.2900,103.8500`,
    headers,
    (data) => ({
      resultCount: Array.isArray(data?.SrchResults) ? data.SrchResults.length : null,
      featureCount: data?.SrchResults?.[0]?.FeatCount ?? null,
      themeName: data?.SrchResults?.[0]?.Theme_Name ?? null,
      first: data?.SrchResults?.[1]
        ? {
            name: data.SrchResults[1].NAME,
            type: data.SrchResults[1].Type,
            latLng: data.SrchResults[1].LatLng,
          }
        : null,
    })
  );

  const failed = Object.values(result.onemap.endpoints).filter((entry) => entry.status !== 'ok');
  result.onemap.status = failed.length ? 'partial_or_failed' : 'ok';
}

async function oneMapJson(name, url, headers, pick) {
  const response = await quotaFetch('onemap', `${name} smoke`, url, { headers });
  const entry = { httpStatus: response.status };
  if (!response.ok) {
    entry.status = 'failed';
    entry.error = await safeText(response);
    return entry;
  }
  const data = await response.json();
  entry.status = 'ok';
  Object.assign(entry, pick(data));
  return entry;
}

async function safeText(response) {
  const text = await response.text();
  return text.slice(0, 500);
}

function readQuotaState() {
  try {
    return JSON.parse(fs.readFileSync(quotaFile, 'utf8'));
  } catch {
    return {};
  }
}

function writeQuotaState() {
  fs.writeFileSync(quotaFile, JSON.stringify(quotaState, null, 2));
}

await smokeDataGov().catch((error) => {
  result.datagov.status = error.code === 'SMOKE_RATE_LIMIT' ? 'rate_limited' : 'error';
  result.datagov.error = error.message;
});

await smokeDataMall().catch((error) => {
  result.datamall.status = error.code === 'SMOKE_RATE_LIMIT' ? 'rate_limited' : 'error';
  result.datamall.error = error.message;
});

await smokeOneMap().catch((error) => {
  result.onemap.status = error.code === 'SMOKE_RATE_LIMIT' ? 'rate_limited' : 'error';
  result.onemap.error = error.message;
});

await smokeOpenRouter().catch((error) => {
  result.openrouter.status = error.code === 'SMOKE_RATE_LIMIT' ? 'rate_limited' : 'error';
  result.openrouter.error = error.message;
});

console.log(JSON.stringify(result, null, 2));
