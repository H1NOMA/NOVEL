/// <reference types="vite/client" />

// GLB-модели кораблей: Vite отдаёт URL встроенного ассета.
declare module '*.glb?url' {
  const url: string;
  export default url;
}
