// No `matches` here: WXT would add them to host_permissions. The background
// registers this script with scripting.registerContentScripts once the user
// grants host access.
export default defineContentScript({
  registration: 'runtime',
  world: 'MAIN',
  allFrames: true,
  matchOriginAsFallback: true,
  runAt: 'document_start',
  main() {},
});
