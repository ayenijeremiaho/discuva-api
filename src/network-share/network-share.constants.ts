export const NETWORK_COPY_QUEUE = 'network-copy';

export interface NetworkCopyJob {
  kind: 'announcement' | 'events' | 'rollup';
  sourceTenantId: string;
  // The announcement for 'announcement'; unused for 'events', which re-copies the church's upcoming events.
  sourceId?: string;
}
