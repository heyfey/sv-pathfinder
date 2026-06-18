// C1 — Scope resolver: active scope (instance) -> module name + resolved parameter
// values (formatted as Verilog literals) + file set for Yosys.
import * as path from 'path';
import { DesignItem, NetlistItem } from '../tree_view';
import { formatParamValue, isEnumParamType } from './param_util';

export interface ResolvedParam {
    name: string;
    verilogLiteral: string;
}

export interface ScopeContext {
    instancePath: string;          // e.g. top.cpu.alu — active-scope key for C5/C6 fallback
    moduleName: string;            // module to root the Yosys run at
    resolvedParams: ResolvedParam[];
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

// Parameters appear as varItem children with type 'parameter'; the resolved value is in
// the item description ("Enum rv32zc_e (logic[31:0]) = 3" for slang, "= 8" for UHDM) — i.e. the
// declared type, then "= <value>".
function collectParams(children: NetlistItem[]): ResolvedParam[] {
    const params: ResolvedParam[] = [];
    for (const child of children) {
        if (child.contextValue !== 'varItem' || child.type !== 'parameter') { continue; }
        const desc = typeof child.description === 'string' ? child.description : '';
        const eq = desc.lastIndexOf('=');
        if (eq < 0) { continue; }
        const typePart = desc.slice(0, eq);
        const literal = formatParamValue(desc.slice(eq + 1));
        if (literal === undefined) {
            console.warn(`schematic: skipping parameter ${child.name} (unparseable value '${desc.slice(eq + 1).trim()}')`);
            continue;
        }
        // Enum-typed params: read_slang rejects a bare-int override and we can't build the package-
        // qualified cast it needs, so skip the override and let the module default apply.
        if (isEnumParamType(typePart)) {
            console.warn(`schematic: not overriding enum parameter ${child.name} (=${literal}); using the module default`);
            continue;
        }
        params.push({ name: child.name, verilogLiteral: literal });
    }
    return params;
}

export async function resolveScope(design: DesignItem, instance: NetlistItem): Promise<ScopeContext> {
    const moduleName = instance.moduleName;
    const instancePath = instance.getHierarchyName();

    const children = await design.getChildrenExternal(instance);
    const resolvedParams = collectParams(children);

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

    return { instancePath, moduleName, resolvedParams, dotF, fileSet, workDir };
}
