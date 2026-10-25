- **tests:** every vitest project now freezes `Date` to a fixed instant before each test
  (`test-support/freeze-date.ts`), so a `toPistar` `saveDate` stamp can no longer straddle a
  wall-clock second and flake a comparison — the recurring cause behind #41, #119, #168 and #228.
  A test that needs the real clock opts out with `useRealDate()` (`test-support/use-real-date.ts`).
  Closes #231.
