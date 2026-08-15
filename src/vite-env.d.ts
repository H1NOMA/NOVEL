/// <reference types="vite/client" />

// GLB-модели кораблей: Vite отдаёт URL встроенного ассета.
declare module '*.glb?url' {
  const url: string;
  export default url;
}

// Рендеры Blender (иконки подразделений, ключевой арт).
declare module '*.webp?url' {
  const url: string;
  export default url;
}
