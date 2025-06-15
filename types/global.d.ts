interface Navigator {}
interface WebGLRenderingContext {}
declare namespace WebAssembly {
  type Imports = Record<string, any>;
  interface Instance {
    readonly exports: Record<string, any>;
  }
  type Exports = Record<string, any>;
}