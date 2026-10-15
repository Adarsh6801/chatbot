'use client';
import {use, useEffect, useState} from 'react';
import Chat from '@/components/Chat';
import {api} from '@/lib/api';
export default function HostedChat({params}:{params:Promise<{slug:string}>}) {
  const {slug}=use(params), [bot,setBot]=useState<any>(null), [error,setError]=useState('');
  useEffect(()=>{api('/public/bots/'+slug).then(setBot).catch(e=>setError(e.message));},[slug]);
  return <main className="hosted-chat">{error?<div className="panel"><h2>Agent unavailable</h2><p>{error}</p></div>:bot?<Chat publicView publicKey={bot.public_key} name={bot.name} greeting={bot.widget_config.greeting} color={bot.widget_config.color} logo={bot.widget_config.logo}/>:<p>Connecting to your agent…</p>}</main>;
}
