# unit-convert

Tiny JavaScript library (no dependencies) to convert lengths
(`mm`, `cm`, `m`, `km`, `in`, `ft`, `mi`) and temperatures (`C`, `F`, `K`).
It has no user interface: it is meant to be imported by other code.

```js
import { convertLength, convertTemperature } from "unit-convert";

convertLength(5, "km", "mi");        // 3.106855...
convertTemperature(20, "C", "F");    // 68
```

## Tests

```bash
npm test
```
