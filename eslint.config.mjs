import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // React Three Fiber scene components intentionally mutate Three.js objects
    // and simulation buffers inside useFrame (the idiomatic R3F render-loop
    // pattern), and seed scenery with Math.random once on mount. These React
    // Compiler rules don't model that, and the compiler is not enabled.
    files: [
      "components/game/BridgeEnvironment.tsx",
      "components/game/CityScape.tsx",
      "components/game/Effects.tsx",
      "components/game/GameCanvas.tsx",
      "components/game/TrafficManager.tsx",
      "components/game/TukTuk.tsx",
      "components/mission/MissionController.tsx",
      "components/mission/MissionPassenger.tsx",
      "components/mission/MissionTraffic.tsx",
      "components/mission/MissionWorld.tsx",
      "components/race/RaceScene.tsx",
    ],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
