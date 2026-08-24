// luaparse resolution.
//
// npm installs bring their own copy. The GitHub Action runs the committed tree with no
// install step, so fall back to the vendored file (MIT, see vendor/LICENSE.luaparse).

let mod;
try {
  mod = (await import('luaparse')).default;
} catch {
  mod = (await import('../vendor/luaparse.cjs')).default;
}

export default mod;
