export default defineContentScript({
  registration: 'runtime',
  allFrames: true,
  matchOriginAsFallback: true,
  runAt: 'document_start',
  main() {},
});
