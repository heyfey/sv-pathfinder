import * as treeSitter from "web-tree-sitter";
import * as vscode from 'vscode';

import * as path from "path";
const VerilogWasmPath = path.join(__dirname, '../parsers/tree-sitter-verilog.wasm');
// const VhdlWasmPath = path.join(__dirname, '../parsers/tree-sitter-vhdl.wasm');

// #region Parser
export class Parser {
    private verilogParser: any;
    private verilogLanguage: any;
    // private vhdlParser: any;
    // private vhdlLanguage: any;

    constructor() {
        this.init();
    }

    public async init(): Promise<void> {
        await treeSitter.Parser.init();
        this.verilogParser = new treeSitter.Parser();
        this.verilogLanguage = await treeSitter.Language.load(VerilogWasmPath);
        this.verilogParser.setLanguage(this.verilogLanguage);

        // this.testParser();
    }

    private async testParser() {
        const fs = require('fs');
        let filePath = "/home/heyfey/waveform/Design/BJsource.v";
        filePath = "/home/heyfey/waveform/Design/tb_CPUsystem.v";
        filePath = "/home/heyfey/waveform/Design/CPU.v";

        const sourceCode = fs.readFileSync(filePath, 'utf8');
        const tree = this.verilogParser.parse(sourceCode);
        // console.log(tree.rootNode.toString());
        this.traverse(tree.rootNode, 0);
        // const targetModule = this.findModuleNode(tree, 'CPU');
        // console.log(targetModule ? `Found module: ${targetModule.text}` : "Module not found.");
        // this.collectIdentifiers(targetModule);
    }

    private traverse(node: treeSitter.Node, depth: number = 0) {
        const indent = ' '.repeat(depth * 2);
        console.log(`[${depth}]${indent}Node type: ${node.type}, text: ${node.text}, start: ${node.startPosition.row}:${node.startPosition.column}, end: ${node.endPosition.row}:${node.endPosition.column}`);
        for (const child of node.namedChildren.filter((child): child is treeSitter.Node => child !== null)) {
            this.traverse(child, depth + 1);
        }
    }

    public parseText(text: string): treeSitter.Tree {
        return this.verilogParser.parse(text);
    }

    public parseDocument(document: vscode.TextDocument): treeSitter.Tree {
        return this.parseText(document.getText());
    }

    public async parseAndCollectIdentifiersInModule(document: vscode.TextDocument, moduleName: string): Promise<treeSitter.Node[] | undefined> {
        const tree = this.parseDocument(document);
        if (!tree) {
            console.error("Failed to parse document.");
            return undefined;
        }
        const moduleNode = this.findModuleNode(tree, moduleName);
        if (!moduleNode) {
            console.error(`Module '${moduleName}' not found.`);
            return undefined;
        }
        const identifiers = this.collectIdentifiers(moduleNode);
        return identifiers;
    }

    private findModuleNode(tree: treeSitter.Tree, moduleName: string): treeSitter.Node | undefined {
        const query = new treeSitter.Query(this.verilogLanguage, `
            (module_declaration
                (module_header
                    (simple_identifier) @name
                    (#eq? @name "${moduleName}")
                )
            ) @module
        `);
        const matches = query.matches(tree.rootNode);
        if (matches.length === 0) {
            console.log(`Module '${moduleName}' not found.`);
            return undefined;
        }
        const moduleCapture = matches[0].captures.find(c => c.name === 'module');
        return moduleCapture ? moduleCapture.node : undefined;
    }

    private collectIdentifiers(moduleNode: treeSitter.Node | undefined): treeSitter.Node[] {
        if (!moduleNode) { return []; }
        // Exclude certain parent types to collect only identifiers for variables and ports.
        // Note: The parent types are based on the tree-sitter-verilog grammar.
        const excludedParentTypes = ['module_header', 'module_instantiation', 'instance_identifier'];
        return this.collectFilteredIdentifiers(moduleNode, excludedParentTypes);
    }

    private collectFilteredIdentifiers(node: treeSitter.Node, excludedParentTypes: string[]): treeSitter.Node[] {
        // There are two ways to collect identifiers:
        // 1. Using tree-sitter query
        // 2. Using tree-sitter cursor
        // Not sure which is faster.
        return this.collectFilteredIdentifiersQuery(node, excludedParentTypes);
        // return this.collectFilteredIdentifiersCursor(node, excludedParentTypes);
    }

    private collectFilteredIdentifiersQuery(node: treeSitter.Node, excludedParentTypes: string[]): treeSitter.Node[] {
        const query = new treeSitter.Query(this.verilogLanguage, `(simple_identifier) @id`);
        const matches = query.matches(node);
        const filteredIds = matches.filter(match => {
            const node = match.captures[0].node;
            const parent = node.parent;
            return parent && !excludedParentTypes.includes(parent.type) &&
            // Exclude port identifiers that are part of named port connections.
            //     mid m1 ( .portA(portB), ...
            // Want to exclude portA and include portB.
            // Tree sitter will parse this like:
            // ...
            //   Node type: named_port_connection, text: .portA(portB), start: 83:1, end: 83:14
            //     Node type: port_identifier, text: portA, start: 83:2, end: 83:7
            //       Node type: simple_identifier, text: portA, start: 83:2, end: 83:7
            //     Node type: expression, text: portB, start: 83:8, end: 83:13
            //       Node type: primary, text: portB, start: 83:8, end: 83:13
            //         Node type: simple_identifier, text: portB, start: 83:8, end: 83:13
                !(parent.type === 'port_identifier' && parent.parent && parent.parent.type === 'named_port_connection');
        });
        return filteredIds.map(match => match.captures[0].node);
    }

    private collectFilteredIdentifiersCursor(node: treeSitter.Node, excludedParentTypes: string[]): treeSitter.Node[] {
        const identifiers: treeSitter.Node[] = [];
        const cursor = node.walk();
        let visiting = true;

        // Can we only visit the named children?
        while (visiting) {
            const current = cursor.currentNode;
            // console.log(`Visiting node: ${current.type}, text: ${current.text}`);
            if (current.type === 'simple_identifier' &&
                current.parent &&
                !excludedParentTypes.includes(current.parent.type) &&
                !(current.parent.type === 'port_identifier' && current.parent.parent && current.parent.parent.type === 'named_port_connection')) {
                identifiers.push(current);
            }
            if (cursor.gotoFirstChild()) { continue; }
            if (cursor.gotoNextSibling()) { continue; }
            do {
                if (!cursor.gotoParent()) {
                    visiting = false;
                    break;
                }
            } while (!cursor.gotoNextSibling());
        }
        // console.log(identifiers.map(id => id.text));
        return identifiers;
    }
}