# R324.1 — getter-safe fixture and cancellation-before-dispatch fence

The first [Fast CI #42085437530](https://github.com/DarkGh0st03/delegation/actions/runs/42085437530)
exercised the Gateway/Coordinator and legacy tests but the five new
R324 tests failed during fixture construction, before any assertions:
`TypeError: Cannot set property phase ... which has only a getter`.
The test harness now supplies its fake `phase` using a configurable
own-property descriptor, never a setter on the real classes.

A separate owner lifecycle review identified a cancellation race:
`cancelTask()` could run while the authenticated agent bind was
in-flight, before R323 had registered its local effect port. A
cancellation flag is now set **synchronously before the first await**,
checked again after the bind ACK and before A2A dispatch, and always
fences the owner port in terminal cleanup. No callback can dispatch
after cancellation even when an in-flight binding later succeeds.

The new negative test cancels a deliberately blocked A2A callback and
asserts that no private effect stage can follow cancellation. Tests
remain offline with disposable Unix sockets and substituted root/
Child/Gateway proof objects: not native EVM or production A2A proof.

No new native Docker E2E, paid model invocation, merge or main change.
