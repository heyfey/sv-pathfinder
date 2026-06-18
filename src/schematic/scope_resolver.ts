// C1 — Scope resolver: active scope (instance) -> module name + resolved parameter
// values (formatted as Verilog literals) + file set for Yosys.
import * as path from 'path';
import { DesignItem, NetlistItem } from '../tree_view';
import { collectParamOverrides } from './param_util';

export interface ResolvedParam {
    name: string;
    verilogLiteral: string;
}

export interface ScopeContext {
    instancePath: string;          // e.g. top.cpu.alu — active-scope key for C5/C6 fallback
    moduleName: string;            // module to root the Yosys run at
    resolvedParams: ResolvedParam[];
    // Enum params we could NOT override (drawn at the module default — possibly inaccurate). The
    // schematic view warns, naming these. See collectParamOverrides for why we can't apply them.
    skippedEnumParams: string[];
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
    const { params: resolvedParams, skippedEnums: skippedEnumParams } = collectParamOverrides(children);

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

    return { instancePath, moduleName, resolvedParams, skippedEnumParams, dotF, fileSet, workDir };
}
