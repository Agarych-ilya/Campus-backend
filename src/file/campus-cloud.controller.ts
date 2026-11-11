import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Body, Controller, Delete, Get, Param, ParseIntPipe,
  Patch, Post, Query, Req, Res, UploadedFile,
  UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { Response } from 'express';
import { ListingsOwnerGuard } from '../services/listings/listings-owner.guard';
import { CampusCloudService, CloudViewer } from './campus-cloud.service';

const storage = diskStorage({
  destination: (_req, _file, callback) => {
    // Resolve after ConfigModule has loaded .env, not during module import.
    const root = resolve(process.env.CAMPUS_CLOUD_STORAGE_DIR || 'cloud-private');
    try {
      mkdirSync(root, { recursive: true });
      callback(null, root);
    } catch (error) { callback(error as Error, ''); }
  },
  filename: (_req, _file, callback) => callback(null, randomUUID()),
});

@Controller('cloud')
export class CampusCloudController {
  constructor(private readonly service: CampusCloudService) {}

  private viewer(req: any): CloudViewer {
    const session = req.session;
    const ts = session?.listingVerifiedAt;
    const valid = typeof ts === 'number' && ts <= Date.now() &&
      Date.now() - ts < 24 * 60 * 60 * 1000 &&
      /^[a-f0-9]{64}$/.test(session?.listingOwnerKey ?? '');
    return valid ? {
      key: session.listingOwnerKey,
      group: typeof session.listingGroup === 'string' &&
        session.listingGroup.trim().length > 0
        ? session.listingGroup : undefined,
    } : {};
  }

  @Get('files')
  list(@Req() req: any, @Query() query: {
    mode?: string; q?: string; folderId?: string;
  }) {
    return this.service.list(this.viewer(req), query);
  }

  @Get('folders')
  folders(@Req() req: any, @Query('mode') mode?: string,
    @Query('q') query?: string) {
    return this.service.folders(this.viewer(req), mode, query);
  }

  private shareUrl(token: string, kind: 'file' | 'folder'): string | null {
    const configured = process.env.CAMPUS_PUBLIC_URL?.trim().replace(/\/$/, '');
    if (!configured) return null;
    try {
      const uri = new URL(configured);
      if (uri.protocol !== 'https:' || uri.username || uri.password ||
          uri.pathname !== '/' || uri.search || uri.hash) {
        return null;
      }
      return uri.origin + '/cloud/' + (kind === 'folder' ? 'f/' : 's/') + token;
    } catch (_) {
      return null;
    }
  }

  @Post('folders/:id/link')
  @UseGuards(ListingsOwnerGuard)
  async folderLink(@Req() req: any,
    @Param('id', ParseIntPipe) id: number) {
    const result = await this.service.createFolderLink(this.viewer(req), id);
    return { ...result, url: this.shareUrl(result.token, 'folder') };
  }

  @Delete('folders/:id/link')
  @UseGuards(ListingsOwnerGuard)
  revokeFolderLink(@Req() req: any,
    @Param('id', ParseIntPipe) id: number) {
    return this.service.revokeFolderLink(this.viewer(req), id);
  }

  @Get('f/:token')
  async sharedFolder(@Param('token') token: string, @Res() res: Response) {
    const data = await this.service.listSharedFolder(token);
    // No scripts, and all uploaded filenames are HTML-escaped to prevent XSS.
    const esc = (value: string) => value.replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;',
      '"': '&quot;', "'": '&#39;',
    }[ch] ?? ch));
    const rows = data.files.map(file =>
      '<li><a href="/cloud/f/' + token + '/files/' + file.id + '">' +
      esc(file.name) + '</a> <small>(' +
      Math.round(file.size / 1024) + ' КБ)</small></li>',
    ).join('');
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'none'; base-uri 'none'; form-action 'none'; " +
        "style-src 'unsafe-inline'; sandbox allow-downloads",
    });
    return res.send(
      '<!doctype html><html lang="ru"><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + esc(data.name) + ' — Cloud Campus</title>' +
      '<body style="font:16px system-ui;max-width:700px;margin:32px auto;' +
      'padding:12px;background:#151515;color:#eee">' +
      '<h1>' + esc(data.name) + '</h1>' +
      '<p>Файлы из общей папки Cloud Campus</p><ul>' + rows + '</ul>' +
      '</body></html>',
    );
  }

  @Get('f/:token/files/:id')
  async sharedFolderFile(@Param('token') token: string,
    @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const file = await this.service.readSharedFolderFile(token, id);
    return this.download(res, file);
  }

  @Post('folders')
  @UseGuards(ListingsOwnerGuard)
  createFolder(@Req() req: any, @Body() dto: any) {
    return this.service.createFolder(this.viewer(req), dto);
  }

  @Patch('folders/:id')
  @UseGuards(ListingsOwnerGuard)
  updateFolder(@Req() req: any, @Param('id', ParseIntPipe) id: number,
    @Body() dto: any) {
    return this.service.updateFolder(this.viewer(req), id, dto);
  }

  @Delete('folders/:id')
  @UseGuards(ListingsOwnerGuard)
  deleteFolder(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.service.deleteFolder(this.viewer(req), id);
  }

  @Post('upload')
  @UseGuards(ListingsOwnerGuard)
  @UseInterceptors(FileInterceptor('file', {
    storage,
    limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 5 },
  }))
  upload(@Req() req: any, @UploadedFile() file: Express.Multer.File,
    @Body() dto: any) {
    return this.service.upload(this.viewer(req), file, dto);
  }

  @Get('s/:token')
  async shared(@Param('token') token: string, @Res() res: Response) {
    const file = await this.service.readLink(token);
    return this.download(res, file);
  }

  private download(res: Response, file: {
    path: string; name: string; mime: string;
  }) {
    res.set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    return res.download(file.path, file.name);
  }

  @Get('files/:id/download')
  async getFile(@Req() req: any,
    @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    return this.download(res, await this.service.read(id, this.viewer(req)));
  }

  @Get('files/:id/preview')
  async preview(@Req() req: any,
    @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const file = await this.service.preview(id, this.viewer(req));
    res.set({
      'Content-Type': file.mime,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    return res.sendFile(file.path);
  }

  @Post('files/:id/save')
  @UseGuards(ListingsOwnerGuard)
  save(@Req() req: any, @Param('id', ParseIntPipe) id: number,
    @Body() dto: any) {
    return this.service.save(this.viewer(req), id, dto);
  }

  @Delete('files/:id/save')
  @UseGuards(ListingsOwnerGuard)
  unsave(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.service.unsave(this.viewer(req), id);
  }

  @Patch('files/:id/name')
  @UseGuards(ListingsOwnerGuard)
  renameFile(@Req() req: any, @Param('id', ParseIntPipe) id: number,
    @Body() dto: any) {
    return this.service.renameFile(this.viewer(req), id, dto);
  }

  @Patch('files/:id/move')
  @UseGuards(ListingsOwnerGuard)
  move(@Req() req: any, @Param('id', ParseIntPipe) id: number,
    @Body() dto: any) {
    return this.service.move(this.viewer(req), id, dto);
  }

  @Patch('files/:id/visibility')
  @UseGuards(ListingsOwnerGuard)
  changeVisibility(@Req() req: any,
    @Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.changeVisibility(this.viewer(req), id, dto);
  }

  @Post('files/:id/link')
  @UseGuards(ListingsOwnerGuard)
  async link(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const result = await this.service.createLink(this.viewer(req), id);
    return { ...result, url: this.shareUrl(result.token, 'file') };
  }

  @Delete('files/:id/link')
  @UseGuards(ListingsOwnerGuard)
  revokeLink(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.service.revokeLink(this.viewer(req), id);
  }

  @Delete('files/:id')
  @UseGuards(ListingsOwnerGuard)
  delete(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(this.viewer(req), id);
  }
}
