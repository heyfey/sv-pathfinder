import * as assert from 'assert';

import { findParentModuleScope, ancestorFallbackReason, isInterfaceTopError, isParamResolutionError, ScopeNode } from '../schematic/scope_nav';

// Build a leaf→root chain of {type} nodes (all contextValue 'scopeItem') and return the leaf, with
// .parent links set. e.g. node('module','scope','scopearray','module') is leaf(module) inside a
// generate block inside its array inside the enclosing module.
function chain(...types: string[]): ScopeNode {
    let parent: ScopeNode | undefined;
    let node: ScopeNode | undefined;
    for (const type of types.slice().reverse()) {
        node = { type, contextValue: 'scopeItem', parent };
        parent = node;
    }
    return node!;
}

suite('findParentModuleScope', () => {
    test('plain module → returns the enclosing module', () => {
        const leaf = chain('module', 'module');           // cpu inside tpu
        assert.strictEqual(findParentModuleScope(leaf), leaf.parent);
        assert.strictEqual(findParentModuleScope(leaf)!.type, 'module');
    });

    test('skips a generate scope + scope array to the real module (the bug)', () => {
        // gradient_descent_inst → gradient_descent_gen[0] (scope) → gradient_descent_gen (scopearray) → ub_inst (module)
        const leaf = chain('module', 'scope', 'scopearray', 'module');
        const ub = leaf.parent!.parent!.parent;           // the enclosing module instance
        assert.strictEqual(findParentModuleScope(leaf), ub);
        assert.strictEqual(findParentModuleScope(leaf)!.type, 'module');
    });

    test('skips an instance array and native generate/begin scopes', () => {
        assert.strictEqual(findParentModuleScope(chain('module', 'instancearray', 'module'))!.type, 'module');
        assert.strictEqual(findParentModuleScope(chain('module', 'generate', 'begin', 'module'))!.type, 'module');
    });

    test('top module (no module ancestor) → undefined (button disabled)', () => {
        assert.strictEqual(findParentModuleScope(chain('module')), undefined);          // no parent
        assert.strictEqual(findParentModuleScope(chain('module', 'scope', 'scopearray')), undefined); // only generate wrappers above
    });

    test('ignores non-scopeItem ancestors', () => {
        const leaf: ScopeNode = { type: 'module', contextValue: 'scopeItem',
            parent: { type: 'module', contextValue: 'varItem',          // not a scopeItem → skipped
                parent: { type: 'module', contextValue: 'scopeItem' } } };
        assert.strictEqual(findParentModuleScope(leaf), leaf.parent!.parent);
    });
});

suite('isInterfaceTopError', () => {
    test('matches the two read_slang interface-port phrasings', () => {
        assert.ok(isInterfaceTopError(new Error('foo: unconnected interface port bar')));
        assert.ok(isInterfaceTopError('interface port on blackbox instance unsupported'));
    });
    test('does not match an unrelated error', () => {
        assert.ok(!isInterfaceTopError(new Error('a generic compile error')));
    });
});

suite('isParamResolutionError', () => {
    test('matches the CVA6 csr_regfile isolation errors (missing CVA6Cfg → bad widths/types)', () => {
        for (const m of [
            'csr_regfile.sv:381:27: error: value must be positive',
            "csr_regfile.sv:402:31: error: invalid member access for type 'jvt_t' (aka 'logic')",
            "csr_regfile.sv:957:43: error: cannot select range of [-3:1] from 'logic[-3:0]' [-Wrange-oob]",
            'csr_regfile.sv:655:32: error: endianness of selection must match declared range',
        ]) { assert.ok(isParamResolutionError(new Error(m)), m); }
    });
    test('does not match a generic compile error', () => {
        assert.ok(!isParamResolutionError(new Error('syntax error: unexpected token')));
    });
});

// Decide whether a failed standalone elaboration should be retried from a top-able ancestor. Interface
// errors always qualify. The 'params' case (a config struct like CVA6Cfg that -G can't carry) is
// detected two independent ways — a recorded skipped param OR a tell-tale width/type error — but only
// when there's a parent to root at; a genuine error with neither signal is rethrown as-is.
suite('ancestorFallbackReason', () => {
    const ifaceErr = new Error('unconnected interface port clk_if');
    const widthErr = new Error('csr_regfile.sv:381: error: value must be positive'); // a param-isolation error
    const genericErr = new Error('syntax error: unexpected token');

    test("interface error → 'interface', regardless of parent", () => {
        assert.strictEqual(ancestorFallbackReason(ifaceErr, 0, true), 'interface');
        assert.strictEqual(ancestorFallbackReason(ifaceErr, 0, false), 'interface');
    });

    test("a recorded skipped param + a parent → 'params' (even when the error isn't a width error)", () => {
        assert.strictEqual(ancestorFallbackReason(genericErr, 1, true), 'params');
    });

    test("a param-isolation width/type error + a parent → 'params' (the CVA6Cfg/csr_regfile case)", () => {
        assert.strictEqual(ancestorFallbackReason(widthErr, 0, true), 'params');
    });

    test('param signal but NO parent → undefined (nothing to root higher at)', () => {
        assert.strictEqual(ancestorFallbackReason(widthErr, 1, false), undefined);
    });

    test('generic error, no skipped params, has parent → undefined (rethrow the real error)', () => {
        assert.strictEqual(ancestorFallbackReason(genericErr, 0, true), undefined);
    });
});
