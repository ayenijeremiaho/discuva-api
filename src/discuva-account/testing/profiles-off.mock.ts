// DiscuvaProfileService with Global Profile off: the church still owns every member's basics.
export function profilesOffMock() {
  return {
    ownerOf: jest.fn().mockResolvedValue(null),
    ensure: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    basicsFor: jest.fn().mockResolvedValue(null),
    reconcile: jest.fn().mockResolvedValue([]),
    resolve: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    writeToChurches: jest.fn().mockResolvedValue(undefined),
  };
}
