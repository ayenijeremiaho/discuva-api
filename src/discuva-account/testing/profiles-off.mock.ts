// DiscuvaProfileService with Global Profile off: the church still owns every member's basics.
export function profilesOffMock() {
  return {
    ownerOf: jest.fn().mockResolvedValue(null),
    ensure: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(undefined),
    writeToChurches: jest.fn().mockResolvedValue(undefined),
  };
}
