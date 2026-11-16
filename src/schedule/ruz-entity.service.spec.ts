import axios from 'axios';
import {BadRequestException,ServiceUnavailableException} from '@nestjs/common';
import {RuzEntityService} from './ruz-entity.service';

describe('Read-only MPEI RUZ person and auditorium schedules',()=>{
  const api=new RuzEntityService();
  afterEach(()=>jest.restoreAllMocks());

  test('search uses fixed routes and filters unsafe results',async()=>{
    const fetch=jest.spyOn(axios,'get').mockResolvedValue({
      data:[
        {id:101,label:'доц. Иванова Н.Н.',description:'Кафедра'},
        {id:101,label:'дубликат'},
        {id:-1,label:'некорректный'},
      ],
    } as never);
    const rows=await api.search('Иванова','person');
    expect(rows).toEqual([{
      id:101,label:'доц. Иванова Н.Н.',
      description:'Кафедра',type:'person',
    }]);
    expect(String(fetch.mock.calls[0][0])).toContain(
      '/api/search?term='+encodeURIComponent('Иванова')+'&type=person');
  });

  test('auditorium lessons map Spark response to read-only lesson data',async()=>{
    const fetch=jest.spyOn(axios,'get').mockResolvedValue({
      data:[{
        auditorium:'М-307',beginLesson:'10:15',
        endLesson:'11:50',date:'2026.11.16',
        discipline:'ТАУ',kindOfWork:'Практика',
        lecturer:'Петров П.П.',group:'А-03-23',
      }],
    } as never);
    const rows=await api.schedule('auditorium','10',
      '2026-11-16','2026-11-23');
    expect(rows[0]).toMatchObject({
      room:'М-307',time:'10:15–11:50',
      subject:'ТАУ',group:'А-03-23',
    });
    expect(String(fetch.mock.calls[0][0])).toContain(
      '/api/schedule/auditorium/10?start=2026.11.16&finish=2026.11.23&lng=1');
  });

  test('rejects bad route names, user-controlled URLs and long date windows',async()=>{
    const get=jest.spyOn(axios,'get');
    await expect(api.search('a','student')).rejects
      .toBeInstanceOf(BadRequestException);
    await expect(api.schedule('person','https://evil.example',
      '2026-11-16','2026-11-23')).rejects
      .toBeInstanceOf(BadRequestException);
    await expect(api.schedule('person','12','2026-01-01','2026-12-01'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(get).not.toHaveBeenCalled();
  });

  test('reports upstream downtime, never fabricates a lesson',async()=>{
    jest.spyOn(axios,'get').mockRejectedValue(
      new Error('RUZ unavailable'));
    await expect(api.search('Иванов','person')).rejects
      .toBeInstanceOf(ServiceUnavailableException);
  });
});
