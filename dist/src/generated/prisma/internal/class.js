"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPrismaClientClass = getPrismaClientClass;
const runtime = __importStar(require("@prisma/client/runtime/client"));
const config = {
    "previewFeatures": [],
    "clientVersion": "7.8.0",
    "engineVersion": "3c6e192761c0362d496ed980de936e2f3cebcd3a",
    "activeProvider": "mysql",
    "inlineSchema": "datasource db {\n  provider = \"mysql\"\n}\n\ngenerator client {\n  provider = \"prisma-client\"\n  output   = \"../src/generated/prisma\"\n}\n\nmodel User {\n  id        Int      @id @default(autoincrement())\n  username  String\n  email     String   @unique\n  password  String   @map(\"password_hash\")\n  createdAt DateTime @default(now()) @map(\"created_at\")\n\n  @@map(\"users\")\n}\n",
    "runtimeDataModel": {
        "models": {},
        "enums": {},
        "types": {}
    },
    "parameterizationSchema": {
        "strings": [],
        "graph": ""
    }
};
config.runtimeDataModel = JSON.parse("{\"models\":{\"User\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"username\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"email\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"password\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"password_hash\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"}],\"dbName\":\"users\"}},\"enums\":{},\"types\":{}}");
config.parameterizationSchema = {
    strings: JSON.parse("[\"where\",\"User.findUnique\",\"User.findUniqueOrThrow\",\"orderBy\",\"cursor\",\"User.findFirst\",\"User.findFirstOrThrow\",\"User.findMany\",\"data\",\"User.createOne\",\"User.createMany\",\"User.updateOne\",\"User.updateMany\",\"create\",\"update\",\"User.upsertOne\",\"User.deleteOne\",\"User.deleteMany\",\"having\",\"_count\",\"_avg\",\"_sum\",\"_min\",\"_max\",\"User.groupBy\",\"User.aggregate\",\"AND\",\"OR\",\"NOT\",\"id\",\"username\",\"email\",\"password\",\"createdAt\",\"equals\",\"in\",\"notIn\",\"lt\",\"lte\",\"gt\",\"gte\",\"not\",\"contains\",\"startsWith\",\"endsWith\",\"search\",\"_relevance\",\"set\",\"increment\",\"decrement\",\"multiply\",\"divide\"]"),
    graph: "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"
};
async function decodeBase64AsWasm(wasmBase64) {
    const { Buffer } = await import('node:buffer');
    const wasmArray = Buffer.from(wasmBase64, 'base64');
    return new WebAssembly.Module(wasmArray);
}
config.compilerWasm = {
    getRuntime: async () => await import("@prisma/client/runtime/query_compiler_fast_bg.mysql.mjs"),
    getQueryCompilerWasmModule: async () => {
        const { wasm } = await import("@prisma/client/runtime/query_compiler_fast_bg.mysql.wasm-base64.mjs");
        return await decodeBase64AsWasm(wasm);
    },
    importName: "./query_compiler_fast_bg.js"
};
function getPrismaClientClass() {
    return runtime.getPrismaClient(config);
}
//# sourceMappingURL=class.js.map