// C1 — Scope resolver: active scope (instance) -> module name + resolved parameter
// values (formatted as Verilog literals) + file set for Yosys.
import * as path from 'path';
import { DesignItem, NetlistItem } from '../tree_view';
import { collectParamOverrides, collectChildModules, SkippedParam } from './param_util';

export interface ResolvedParam {
    name: string;
    verilogLiteral: string;
}

export interface ScopeContext {
    instancePath: string;          // e.g. top.cpu.alu — active-scope key for C5/C6 fallback
    moduleName: string;            // module to root the Yosys run at
    resolvedParams: ResolvedParam[];
    // Params we could NOT override (enum/struct/array/elided values — drawn at the module default,
    // possibly inaccurate). The schematic view warns for non-top scopes, naming these + their
    // declaration location. See collectParamOverrides.
    skippedParams: SkippedParam[];
    // Module names of the scope's direct child instances — for shallow elaboration's
    // --blackboxed-module (selected+1). See collectChildModules.
    childModules: string[];
    // Either a .f command file (preferred: slang understands -f/-F) or an explicit file list.
    dotF?: string;
    fileSet: string[];
    workDir: string;               // cwd for the Yosys subprocess (relative .f paths)
}

// Cache key is INSTANCE-specific: same module with different params renders differently.
export function scopeCacheKey(ctx: ScopeContext, preset: string): string {
    const params = ctx.resolvedParams
        .map(p => `${p.name}=${p.verilogLiteral}`)
        .sort()
        .join(',');
    return `${ctx.moduleName}|${params}|${preset}`;
}

export async function resolveScope(design: DesignItem, instance: NetlistItem): Promise<ScopeContext> {
    const moduleName = instance.moduleName;
    const instancePath = instance.getHierarchyName();

    const children = await design.getChildrenExternal(instance);
    const { params: resolvedParams, skippedParams } = collectParamOverrides(children);
    const childModules = collectChildModules(children, moduleName);

    const designPath = design.resourceUri.fsPath;
    let dotF: string | undefined;
    let fileSet: string[] = [];
    let workDir: string;
    if (designPath.endsWith('.f')) {
        // .f designs (slang-server / Surelog flows): hand the command file to read_slang
        // (-f) — over-providing the whole filelist is the v1-correct approach.
        dotF = designPath;
        workDir = path.dirname(designPath);
    } else {
        // UHDM/Kuzu designs: over-provide every module definition's source file.
        const files = new Set<string>();
        for (const mod of design.getModuleInstances()) {
            if (mod.sourceFile) { files.add(mod.sourceFile); }
        }
        if (instance.sourceFile) { files.add(instance.sourceFile); }
        fileSet = [...files];
        workDir = fileSet.length > 0 ? path.dirname(fileSet[0]) : path.dirname(designPath);
    }

    return { instancePath, moduleName, resolvedParams, skippedParams, childModules, dotF, fileSet, workDir };
}
