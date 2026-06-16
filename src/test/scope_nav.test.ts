import * as assert from 'assert';

import { findParentModuleScope, ScopeNode } from '../schematic/scope_nav';

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
