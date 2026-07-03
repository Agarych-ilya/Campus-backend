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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileService = void 0;
const common_1 = require("@nestjs/common");
const db_service_1 = require("../../db.service");
const fs = __importStar(require("fs"));
let FileService = class FileService {
    db;
    constructor(db) {
        this.db = db;
    }
    async postFile(file) {
        if (!file) {
            throw new common_1.BadRequestException('Empty request');
        }
        await this.db.query('INSERT INTO cloud (name, path) VALUES (?, ?)', [file.filename, file.path]);
        return {
            filename: file.filename,
            path: file.path
        };
    }
    async getFile(id) {
        const files = await this.db.query('SELECT * FROM cloud WHERE id = ? LIMIT 1', [id]);
        if (!files[0]) {
            throw new common_1.NotFoundException(`Not found (${id})`);
        }
        return {
            message: 'Success!',
            path: files[0].path
        };
    }
    async deleteFile(id) {
        const result = await this.db.query('SELECT * FROM cloud WHERE id = ? LIMIT 1', [id]);
        if (!result[0]) {
            throw new common_1.NotFoundException(`Not found (${id})`);
        }
        const path = result[0].path;
        if (fs.existsSync(path)) {
            fs.unlinkSync(path);
        }
        await this.db.query('DELETE FROM cloud WHERE id = ?', [id]);
        return {
            message: 'Success!'
        };
    }
};
exports.FileService = FileService;
exports.FileService = FileService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [db_service_1.DbService])
], FileService);
//# sourceMappingURL=file.service.js.map