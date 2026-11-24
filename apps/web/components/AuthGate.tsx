'use client';
import {FormEvent, useEffect, useState} from 'react';
import {ArrowRight,BookOpen,Code2,Flame,ShieldCheck} from 'lucide-react';
import {api,API} from '@/lib/api';
import {UserProfile} from './AccountProfile';
import {SiteLogo,SiteName} from './SiteBranding';

export default function AuthGate({onUser}:{onUser:(user:UserProfile)=>void}){
  const [signup,setSignup]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [google,setGoogle]=useState<boolean|null>(null);

  useEffect(()=>{api('/auth/config').then(d=>setGoogle(d.google_enabled)).catch(()=>setGoogle(false));},[]);

  async function signIn(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setBusy(true);setError('');
    const data=new FormData(event.currentTarget);
    try{
      onUser(await api<UserProfile>('/auth/login',{method:'POST',body:JSON.stringify({email:data.get('email'),password:data.get('password')})}));
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }

  function googleAuth(){
    if(google)window.location.assign(API+'/api/v1/auth/google/start');
    else setError('Google sign-in is not connected yet. Configure your Google OAuth client using the setup guide, then restart the API.');
  }

  return <main className="auth-page"><div className="auth-story"><a href="/" className="brand"><SiteLogo className="brand-icon" fallback={<div className="brand-icon"><Flame size={22}/></div>} alt=""/><SiteName period/></a><div><span className="badge">YOUR KNOWLEDGE, IN CONVERSATION</span><h1>Helpful bots.<br/>Connected flows.<br/><em>Built by you.</em></h1><p>Bring your knowledge, connect your tools, and create the conversations your customers need.</p><div className="auth-pills"><span><BookOpen size={16}/>Knowledge answers</span><span><Code2 size={16}/>Visual workflows</span><span><ShieldCheck size={16}/>Your workspace</span></div></div><small>Build once. Let your agent take it from there.</small></div><div className="auth-form-wrap"><form className="auth-form" onSubmit={signup?event=>event.preventDefault():signIn}><div className="eyebrow">YOUR NEXT GREAT AGENT STARTS HERE</div><h2>{signup?'Create your workspace':'Welcome back'}</h2><p>{signup?'Create your account securely with Google.':'Sign in to your agents, workflows, and knowledge.'}</p><button type="button" className="google-auth-button full" disabled={busy||google===null} onClick={googleAuth}><span className="google-letter">G</span>{signup?'Continue with Google':'Sign in with Google'}</button>{google===false&&<p className="google-setup-hint">Google {signup?'sign-up':'sign-in'} needs <a href="/setup" target="_blank" rel="noreferrer">workspace setup</a>.</p>}{!signup&&<><div className="auth-divider"><span/>or sign in with email<span/></div><label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@company.com"/></label><label>Password<input name="password" type="password" autoComplete="current-password" minLength={10} maxLength={128} required placeholder="Your password"/></label><button className="primary full" disabled={busy}>{busy?'Opening workspace…':'Sign in'}<ArrowRight size={16}/></button></>}{error&&<div className="error" role="alert">{error}</div>}<p className="auth-switch">{signup?'Already have an account?':'New here?'}<button type="button" onClick={()=>{setSignup(!signup);setError('');}}>{signup?'Sign in':'Create an account'}</button></p><div className="auth-trust"><ShieldCheck size={15}/>{signup?'Quick and secure Google registration':'Your account stays protected'}</div></form></div></main>;
}
