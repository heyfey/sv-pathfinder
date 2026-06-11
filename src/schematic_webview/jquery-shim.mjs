// esbuild --inject shim: digitaljs + jquery-ui expect a global jQuery
// (digitaljs's own webpack build uses ProvidePlugin; this is the esbuild analog).
import jq from 'jquery';
globalThis.$ = jq;
globalThis.jQuery = jq;
export { jq as $, jq as jQuery };
