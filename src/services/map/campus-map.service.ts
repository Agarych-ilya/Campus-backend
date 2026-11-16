import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db.service';
import { CreateMapMarkerDto, MapMarkerKind, UpdateMapMarkerDto } from './campus-map.dto';

type MapRow = {
  id: string; name: string; description: string; address: string;
  kind: MapMarkerKind; latitude: number | string; longitude: number | string;
};

export type CampusMapMarker = {
  id: string; name: string; description: string; address: string;
  kind: MapMarkerKind; latitude: number; longitude: number;
};

const originalCampusPlaces: Array<Omit<CampusMapMarker, 'id'>> = [
  { name: 'Главный учебный корпус', description: 'Корпуса А, Б, В, Г, Д',
    address: 'Красноказарменная ул., 17', kind: 'building', latitude: 55.7554, longitude: 37.7089 },
  { name: 'Административный корпус', description: 'Корпуса Ж, З, И, К, Л',
    address: 'Красноказарменная ул., 14', kind: 'building', latitude: 55.7564, longitude: 37.7070 },
  { name: 'Корпус М', description: 'Учебный корпус',
    address: 'Красноказарменная ул., 13', kind: 'building', latitude: 55.7562, longitude: 37.7102 },
  { name: 'Библиотека МЭИ', description: 'Научно-техническая библиотека',
    address: 'Красноказарменная ул., 13', kind: 'library', latitude: 55.7560, longitude: 37.7106 },
  { name: 'Корпус Т', description: 'Учебный корпус',
    address: 'Красноказарменная ул., 17, стр. 4', kind: 'building', latitude: 55.7549, longitude: 37.7110 },
  { name: 'Дом культуры МЭИ', description: 'ДК МЭИ',
    address: 'Энергетический проезд, 3, стр. 1', kind: 'culture', latitude: 55.7539, longitude: 37.7130 },
  { name: 'Бассейн МЭИ', description: 'Спортивный комплекс',
    address: 'Энергетический проезд, 3, стр. 3', kind: 'sports', latitude: 55.7537, longitude: 37.7140 },
];

@Injectable()
export class CampusMapService {
  constructor(private readonly db: DbService) {}

  private setup?: Promise<void>;

  private ensureSchema(): Promise<void> {
    if (!this.setup) {
      this.setup = this.initialize().catch(error => {
        this.setup = undefined;
        throw error;
      });
    }
    return this.setup;
  }

  private async initialize(): Promise<void> {
    await this.db.query(
      'CREATE TABLE IF NOT EXISTS campus_map_markers (' +
      'id VARCHAR(64) NOT NULL PRIMARY KEY, ' +
      'name VARCHAR(100) NOT NULL, description VARCHAR(400) NOT NULL, ' +
      'address VARCHAR(200) NOT NULL, kind VARCHAR(20) NOT NULL, ' +
      'latitude DOUBLE NOT NULL, longitude DOUBLE NOT NULL, ' +
      'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, ' +
      'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' +
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    );
    await this.db.query(
      'CREATE TABLE IF NOT EXISTS campus_map_metadata (' +
      'meta_key VARCHAR(80) NOT NULL PRIMARY KEY, ' +
      'meta_value VARCHAR(80) NOT NULL' +
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    );
    const rows = await this.db.query(
      "SELECT meta_key FROM campus_map_metadata WHERE meta_key='initial_markers_v1' LIMIT 1",
    ) as Array<{ meta_key: string }>;
    if (rows.length) return;

    // One-time migration from the Flutter hard-coded markers. The sentinel
    // is retained if every marker gets deleted, so deleted places stay deleted.
    for (let i = 0; i < originalCampusPlaces.length; i++) {
      const marker = originalCampusPlaces[i];
      await this.db.query(
        'INSERT IGNORE INTO campus_map_markers ' +
        '(id,name,description,address,kind,latitude,longitude) VALUES (?,?,?,?,?,?,?)',
        ['seed-' + (i + 1), marker.name, marker.description,
          marker.address, marker.kind, marker.latitude, marker.longitude],
      );
    }
    await this.db.query(
      "INSERT IGNORE INTO campus_map_metadata (meta_key,meta_value) VALUES ('initial_markers_v1','done')",
    );
  }

  private format(row: MapRow): CampusMapMarker {
    return {
      id: row.id, name: row.name, description: row.description,
      address: row.address, kind: row.kind,
      latitude: Number(row.latitude), longitude: Number(row.longitude),
    };
  }

  async list(): Promise<CampusMapMarker[]> {
    await this.ensureSchema();
    const rows = await this.db.query(
      'SELECT id,name,description,address,kind,latitude,longitude ' +
      'FROM campus_map_markers ORDER BY name ASC LIMIT 501',
    ) as MapRow[];
    return rows.map(row => this.format(row));
  }

  private clean(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
  }

  private validateLocation(latitude: number, longitude: number): void {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 ||
        longitude < -180 || longitude > 180) {
      throw new BadRequestException('Некорректные координаты');
    }
  }

  async create(dto: CreateMapMarkerDto): Promise<CampusMapMarker> {
    await this.ensureSchema();
    this.validateLocation(dto.latitude, dto.longitude);
    const existing = await this.list();
    if (existing.length >= 500) {
      throw new ConflictException('На карте может быть не более 500 меток');
    }
    const marker: CampusMapMarker = {
      id: randomUUID(), name: this.clean(dto.name),
      description: this.clean(dto.description), address: this.clean(dto.address),
      kind: dto.kind, latitude: dto.latitude, longitude: dto.longitude,
    };
    if (marker.name.length < 2) throw new BadRequestException('Укажи название места');
    await this.db.query(
      'INSERT INTO campus_map_markers ' +
      '(id,name,description,address,kind,latitude,longitude) VALUES (?,?,?,?,?,?,?)',
      [marker.id, marker.name, marker.description, marker.address,
        marker.kind, marker.latitude, marker.longitude],
    );
    return marker;
  }

  async update(id: string, dto: UpdateMapMarkerDto): Promise<CampusMapMarker> {
    await this.ensureSchema();
    const rows = await this.db.query(
      'SELECT id,name,description,address,kind,latitude,longitude ' +
      'FROM campus_map_markers WHERE id=? LIMIT 1', [id],
    ) as MapRow[];
    if (!rows.length) throw new NotFoundException('Метка не найдена');
    const previous = this.format(rows[0]);
    const marker: CampusMapMarker = {
      id,
      name: dto.name === undefined ? previous.name : this.clean(dto.name),
      description: dto.description === undefined ? previous.description : this.clean(dto.description),
      address: dto.address === undefined ? previous.address : this.clean(dto.address),
      kind: dto.kind ?? previous.kind,
      latitude: dto.latitude ?? previous.latitude,
      longitude: dto.longitude ?? previous.longitude,
    };
    if (marker.name.length < 2) throw new BadRequestException('Укажи название места');
    this.validateLocation(marker.latitude, marker.longitude);
    const result = await this.db.query(
      'UPDATE campus_map_markers SET name=?,description=?,address=?,kind=?,latitude=?,longitude=? WHERE id=?',
      [marker.name, marker.description, marker.address, marker.kind,
        marker.latitude, marker.longitude, id],
    ) as { affectedRows?: number };
    if (!result.affectedRows) throw new NotFoundException('Метка удалена');
    return marker;
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    await this.ensureSchema();
    const result = await this.db.query(
      'DELETE FROM campus_map_markers WHERE id=?', [id],
    ) as { affectedRows?: number };
    if (!result.affectedRows) throw new NotFoundException('Метка не найдена');
    return { deleted: true };
  }
}
