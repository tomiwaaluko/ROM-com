export interface MockSession {
  sessionNumber: number;
  date: string;
  fmaScore: {
    domainA: number;
    domainC: number;
    domainE: number;
    total: number;
  };
  exercisesCompleted: string[];
}

export const mockSessionHistory: MockSession[] = [
  {
    sessionNumber: 1,
    date: '2026-04-10',
    fmaScore: { domainA: 15, domainC: 5, domainE: 2, total: 22 },
    exercisesCompleted: ['target_reach'],
  },
  {
    sessionNumber: 2,
    date: '2026-04-11',
    fmaScore: { domainA: 17, domainC: 6, domainE: 2, total: 25 },
    exercisesCompleted: ['target_reach', 'trajectory_trace'],
  },
  {
    sessionNumber: 3,
    date: '2026-04-12',
    fmaScore: { domainA: 18, domainC: 6, domainE: 3, total: 27 },
    exercisesCompleted: ['target_reach', 'trajectory_trace'],
  },
  {
    sessionNumber: 4,
    date: '2026-04-13',
    fmaScore: { domainA: 20, domainC: 6, domainE: 3, total: 29 },
    exercisesCompleted: ['target_reach', 'trajectory_trace'],
  },
  {
    sessionNumber: 5,
    date: '2026-04-15',
    fmaScore: { domainA: 21, domainC: 7, domainE: 3, total: 31 },
    exercisesCompleted: ['target_reach', 'trajectory_trace'],
  },
  {
    sessionNumber: 6,
    date: '2026-04-16',
    fmaScore: { domainA: 22, domainC: 7, domainE: 4, total: 33 },
    exercisesCompleted: ['target_reach', 'trajectory_trace'],
  },
  {
    sessionNumber: 7,
    date: '2026-04-17',
    fmaScore: { domainA: 24, domainC: 7, domainE: 4, total: 35 },
    exercisesCompleted: ['target_reach', 'trajectory_trace'],
  },
];

export const mockROMData = {
  shoulderFlex: 145,
  shoulderAbd: 160,
  elbowExt: 170,
  wristFlex: 65,
  wristExt: 55,
};

export const fullROMData = {
  shoulderFlex: 180,
  shoulderAbd: 180,
  elbowExt: 180,
  wristFlex: 90,
  wristExt: 80,
};
