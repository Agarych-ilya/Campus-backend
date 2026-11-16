import {
  BadRequestException, Injectable, ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';

type SearchKind = 'person' | 'auditorium';
export type RuzEntity = {
  id:number;label:string;description:string;type:SearchKind;
};
export type RuzExternalLesson = {
  date:string;time:string;subject:string;type:string;
  room:string;teacher:string;group:string;
};

@Injectable()
export class RuzEntityService {
  private kind(kind:string): SearchKind {
    if (kind !== 'person' && kind !== 'auditorium') {
      throw new BadRequestException('Укажи преподавателя или аудиторию');
    }
    return kind;
  }

  private validDay(raw:string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      throw new BadRequestException('Некорректная дата');
    }
    const parsed=new Date(raw+'T00:00:00Z');
    if (Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0,10) !== raw) {
      throw new BadRequestException('Некорректная дата');
    }
    return raw.replace(/-/g,'.');
  }

  private async api(path:string):Promise<unknown> {
    let failed=false;
    // Fixed university host + fixed route; no URL from the client.
    for(const origin of ['https://ts.mpei.ru','http://ts.mpei.ru']){
      try {
        const response=await axios.get<unknown>(origin+path,{
          timeout:10000,maxRedirects:0,maxContentLength:1024*1024,
          headers:{
            accept:'application/json',
            referer:'https://ts.mpei.ru/ruz/main',
            'user-agent':'CampusApp RUZ read-only lookup',
          },
          validateStatus:(status)=>status===200,
        });
        return response.data;
      } catch (_) {failed=true;}
    }
    if(failed) throw new ServiceUnavailableException(
      'Сервис расписания РУЗ МЭИ сейчас недоступен',
    );
    throw new ServiceUnavailableException('Не удалось прочитать РУЗ');
  }

  async search(query:string,kind:string):Promise<RuzEntity[]> {
    const type=this.kind(kind);
    const q=query.trim();
    if(q.length<2||q.length>70) {
      throw new BadRequestException('Введи от 2 до 70 символов');
    }
    const response=await this.api('/api/search?term='+
      encodeURIComponent(q)+'&type='+type);
    const list=Array.isArray(response)?response:
      response && typeof response==='object' &&
        'results' in response ? (response as {results:unknown}).results:
      response && typeof response==='object' &&
        'data' in response ? (response as {data:unknown}).data:null;
    if(!Array.isArray(list)) {
      throw new ServiceUnavailableException('РУЗ изменил формат поиска');
    }
    const entries: RuzEntity[]=[];
    const ids=new Set<number>();
    for(const item of list.slice(0,100)) {
      if(!item || typeof item!=='object') continue;
      const obj=item as Record<string,unknown>;
      const id=Number(obj.id), label=obj.label ?? obj.name;
      if(!Number.isSafeInteger(id)||id<=0||id>2147483647 ||
          typeof label!=='string'||!label.trim()||label.length>160 ||
          ids.has(id)) continue;
      ids.add(id);
      entries.push({
        id,label:label.trim(),type,
        description:typeof obj.description==='string'
          ? obj.description.slice(0,220):'',
      });
      if(entries.length>=30) break;
    }
    return entries;
  }

  async schedule(
    kind:string,id:string,from:string,to:string,
  ):Promise<RuzExternalLesson[]> {
    const type=this.kind(kind);
    if(!/^\d{1,9}$/.test(id)||Number(id)<1) {
      throw new BadRequestException('Некорректный ID расписания');
    }
    const start=this.validDay(from),finish=this.validDay(to);
    const days=(Date.parse(to+'T00:00:00Z') -
      Date.parse(from+'T00:00:00Z'))/86400000;
    if(days<0||days>31) {
      throw new BadRequestException('Период не более 32 дней');
    }
    const data=await this.api('/api/schedule/'+type+'/'+id+
      '?start='+start+'&finish='+finish+'&lng=1');
    if(!Array.isArray(data)||data.length>500) {
      throw new ServiceUnavailableException('РУЗ вернул неожиданный ответ');
    }
    const clean=(x:unknown):string=>
      typeof x==='string'?x.trim().slice(0,220):'';
    return data.filter((x):x is Record<string,unknown>=>
      !!x&&typeof x==='object'&&!Array.isArray(x)).map(x=>({
        date:clean(x.date),
        time:[clean(x.beginLesson),clean(x.endLesson)]
          .filter(Boolean).join('–'),
        subject:clean(x.discipline),
        type:clean(x.kindOfWork),
        room:clean(x.auditorium),
        teacher:clean(x.lecturer),
        group:clean(x.stream)||clean(x.group),
      }));
  }
}
