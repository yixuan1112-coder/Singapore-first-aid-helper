export type QuickBeatSfx = 'stamp' | 'whoosh' | 'chime' | 'page-flip';

export interface ShowcaseBeat {
  id: string;
  mark: string;
  chapter: string;
  sceneId: string;
  speaker: string;
  narration: string;
  sfx: QuickBeatSfx;
}

/** Hard wall-clock budget once the citizen map is ready. Login happens before this starts. */
export const RUN_BUDGET_MS = 60000;

export const showcaseBeats: ShowcaseBeat[] = [
  {
    id: 'intro',
    mark: '00:00',
    chapter: 'Smoke at Exit B',
    sceneId: 'qs-intro',
    speaker: 'Director',
    narration:
      'In the next sixty seconds, you will watch one real KampungKaki session where rain, smoke, and a medical emergency unfold on the same live map.',
    sfx: 'stamp',
  },
  {
    id: 'conditions',
    mark: '00:10',
    chapter: 'Pelita · conditions',
    sceneId: 'qs-conditions',
    speaker: 'Director',
    narration:
      'Mei Ling opens Pelita, the conditions agent, and asks what the map already shows about rain and traffic near Nicoll Highway M R T Exit B.',
    sfx: 'page-flip',
  },
  {
    id: 'sos',
    mark: '00:22',
    chapter: 'Medical SOS',
    sceneId: 'qs-sos',
    speaker: 'Mei Ling',
    narration:
      'When an elderly man collapses near the smoke, I send a Medical S O S, and the map anchors every hospital and A E D check to this location.',
    sfx: 'stamp',
  },
  {
    id: 'bekal',
    mark: '00:34',
    chapter: 'Bekal · SOS companion',
    sceneId: 'qs-bekal',
    speaker: 'Director',
    narration:
      'Bekal, the S O S companion, finds the nearest A E D and emergency hospital, then turns those answers into map pins Mei Ling can follow right away.',
    sfx: 'chime',
  },
  {
    id: 'coordination',
    mark: '00:46',
    chapter: 'MQTT · one truth',
    sceneId: 'qs-coordination',
    speaker: 'Director',
    narration:
      'The same incident reaches Aisha on duty and Nadia in ops through retained M Q T T topics, without anyone retyping the story.',
    sfx: 'whoosh',
  },
  {
    id: 'outro',
    mark: '00:54',
    chapter: 'Close',
    sceneId: 'qs-outro',
    speaker: 'Director',
    narration:
      'That is KampungKaki: live map evidence, A I Kaki guidance, and neighbourhood coordination in under one minute.',
    sfx: 'stamp',
  },
];

export const cutscenes = {
  smoke: {
    image: '/demo/cutscenes/mrt-ebike-fire.png',
    title: 'Smoke at M R T Exit B',
    detail: 'Rain, e-bike smoke, and a crowded choke point — seconds before someone goes down.',
  },
  tunnel: {
    image: '/demo/cutscenes/train-tunnel.png',
    title: 'Medical S O S sent',
    detail: 'The map locks hospitals, A E Ds, and responders to this exact location.',
  },
} as const;
