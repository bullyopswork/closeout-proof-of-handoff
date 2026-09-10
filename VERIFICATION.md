# Verification

Verified locally on September 10, 2026 before publication.

## Environment

- Node.js `v24.18.0`
- npm `11.16.0`
- Playwright `1.62.1`
- Google Chrome `152.0.7977.83`

The public CI workflow uses Node.js 24 and the Chromium version installed by
the locked Playwright package.

## Commands and results

### Static syntax checks

```text
npm run check
```

Result: passed for the production JavaScript, data module, regression suite,
and screenshot harness.

### Production regression suite

```text
npm test
```

Result: passed. The suite covered:

- registration and read/output contracts for all 10 Site Tools;
- cold-judge rehearsal from `9/14` to `10/14` ready;
- ten complete apply/reset/stale-token flows;
- reject, defer, reopen, and keyboard behavior;
- lifecycle authority and consumed-to-next-lane behavior;
- decision-digest fault injection and rejection before mutation;
- desktop/mobile selection focus restoration;
- owner-acceptance apply/reopen behavior; and
- untrusted input and mutation guards.

### Rendered UI capture

The existing Playwright capture harness passed at 1440×900 desktop and 390×844
mobile viewports with:

- no horizontal overflow;
- no broken visible images;
- no controls smaller than 40×40 CSS pixels;
- no recorded console or page errors; and
- all 10 Site Tools registered in the isolated harness.

## Source hashes

```text
9e86ee7a5d6f839782339c985dd2671f88cb68bb55b60828228cf02fbb4e702d  app/app.js
e464906cd8517d5a1967043f941ecf604aef77cdbf4f840ff9aa9640c932b1fc  tests/run-production-regression.mjs
d243738cff7393f7d36c745484f189142e3b0b7f7a2d68e60da7d51e9254983e  app/index.html
62d45af735ebc41fa425f72ec523c78cd8e9ff20e9e27ff9240c019d479f3d04  app/styles.css
75a046246123de9a6db2e989a8f9c582a2c42ecfcc2016001a97506e9a38fb85  package-lock.json
ec1a025026ce2c9fa888767bbd37ee43f16a3553111709d209a58f2cd5b81378  docs/images/closeout-desktop-approved.png
c3a14b643301c4609f9d4806c5c265bcfc3b88738d96d3efbb378972ea9691e8  docs/images/closeout-mobile-approved.png
```

These hashes identify the candidate files tested locally. GitHub Actions is the
public proof gate for each pushed commit.
