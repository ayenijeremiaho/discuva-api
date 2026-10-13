// Public live screens (service audience/presentation, game screen) poll every 30 s per phone, and a congregation on
// church Wi-Fi shares one address; read-only and cached, so this allows a few thousand phones per address.
export const LIVE_SCREEN_LIMIT = 3000;
