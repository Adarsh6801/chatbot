'use client';
import {useEffect,useState} from 'react';
import {AlertTriangle,ArrowRight,Bot as BotIcon,Check,CreditCard,ExternalLink,LogOut,Mail,ShieldCheck,Trash2,UserRound,X,Zap} from 'lucide-react';
import {api,API,Bot} from '@/lib/api';

export type UserProfile={id:string;name:string;email:string;plan:string;avatar_url?:string;company?:string;bio?:string;google_connected?:boolean;created_at?:string};
type DeletionSummary={
  plan:string;
  billing_provider?:string;
  has_active_subscription:boolean;
  has_paid_plan:boolean;
  has_pending_subscription?:boolean;
  total_bots:number;
  published_bots:number;
  active_bots?:number;
  draft_bots?:number;
  bots?:{id:string;name:string;published:boolean}[];
};

export default function AccountProfile({
  user,
  usage,
  bots=[],
  onUpdate,
  onSubscribe,
  onLogout,
  onDeleted,
  notify,
}:{
  user:UserProfile;
  usage?:any;
  bots?:Bot[];
  onUpdate:(user:UserProfile)=>void;
  onSubscribe:()=>void;
  onLogout:()=>void;
  onDeleted:()=>void;
  notify:(message:string)=>void;
}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[google,setGoogle]=useState(false);
  const [deleteOpen,setDeleteOpen]=useState(false),[checkingDelete,setCheckingDelete]=useState(false),[deleting,setDeleting]=useState(false),[deleteError,setDeleteError]=useState(''),[confirmText,setConfirmText]=useState(''),[deletionSummary,setDeletionSummary]=useState<DeletionSummary|null>(null);

  useEffect(()=>{api('/auth/config').then(d=>setGoogle(d.google_enabled)).catch(()=>{});},[]);

  useEffect(()=>{
    if(!deleteOpen)return;
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!deleting)setDeleteOpen(false);
    };
    window.addEventListener('keydown',onKeyDown);
    return()=>window.removeEventListener('keydown',onKeyDown);
  },[deleteOpen,deleting]);

  function fallbackSummary():DeletionSummary{
    const published=bots.filter(b=>b.published).length;
    return {
      plan:user.plan,
      billing_provider:usage?.payment_provider,
      has_active_subscription:Boolean(usage?.has_subscription),
      has_paid_plan:user.plan!=='free',
      has_pending_subscription:Boolean(usage?.has_pending_subscription),
      total_bots:bots.length,
      published_bots:published,
      active_bots:published,
      draft_bots:bots.length-published,
      bots:bots.map(b=>({id:b.id,name:b.name,published:Boolean(b.published)})),
    };
  }

  async function openDeleteModal(){
    setCheckingDelete(true);
    setDeleteError('');
    setConfirmText('');
    try{
      const summary=await api<DeletionSummary>('/account/deletion-summary');
      setDeletionSummary(summary);
    }catch{
      setDeletionSummary(fallbackSummary());
    }finally{
      setCheckingDelete(false);
      setDeleteOpen(true);
    }
  }

  async function confirmPermanentDelete(){
    if(confirmText.trim()!=='DELETE'||deleting)return;
    setDeleting(true);
    setDeleteError('');
    try{
      await api('/account',{method:'DELETE'});
      setDeleteOpen(false);
      onDeleted();
    }catch(e){
      setDeleteError((e as Error).message);
      setDeleting(false);
    }
  }

  const activeSummary=deletionSummary||fallbackSummary();
  const hasSubscriptionWarning=activeSummary.has_active_subscription||activeSummary.has_paid_plan||Boolean(activeSummary.has_pending_subscription);
  const hasBotsWarning=activeSummary.total_bots>0;
  const planName=activeSummary.plan.charAt(0).toUpperCase()+activeSummary.plan.slice(1);
  const providerName=activeSummary.billing_provider==='razorpay'?'Razorpay':'Stripe';

  return <>
    <div className="page-heading"><div><div className="eyebrow">YOUR ACCOUNT</div><h1>Make yourself at home.</h1><p>Manage your profile, sign-in method, and subscription.</p></div><button className="secondary logout-visible" onClick={onLogout}><LogOut size={15}/>Log out</button></div>
    <div className="profile-layout">
      <form className="panel profile-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');const form=new FormData(e.currentTarget);try{const d=await api<UserProfile>('/account/profile',{method:'PATCH',body:JSON.stringify(Object.fromEntries(form.entries()))});onUpdate(d);notify('Your profile has been updated.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
        <div className="profile-intro"><div className="profile-avatar">{user.avatar_url?<img src={user.avatar_url} alt="Your profile"/>:<UserRound size={28}/>}</div><div><h2>{user.name}</h2><p>{user.email}</p><span className="status live">{usage?.display_plan==='none'?'No active plan':`${usage?.display_plan ?? user.plan} plan`}</span></div></div>
        <h3>Personal information</h3>
        <div className="form-grid"><label>Full name<input name="name" defaultValue={user.name} required maxLength={80}/></label><label>Company or organization<input name="company" defaultValue={user.company||''} maxLength={120} placeholder="Optional"/></label></div>
        <label>Email address<input value={user.email} readOnly/><small>Your account email is managed by your sign-in method.</small></label>
        <label>About you<textarea name="bio" rows={3} maxLength={500} defaultValue={user.bio||''} placeholder="A little about you or your team…"/></label>
        <label>Profile image URL<input type="url" name="avatar_url" defaultValue={user.avatar_url||''} placeholder="https://example.com/your-image.jpg"/><small>Google profiles automatically use your Google account image.</small></label>
        {error&&<div className="error" role="alert">{error}</div>}
        <button className="primary" disabled={busy}>{busy?'Saving…':'Save profile'}<Check size={15}/></button>
      </form>
      <div className="profile-side">
        <div className="panel profile-signin"><div className="profile-card-icon"><ShieldCheck size={20}/></div><h3>Sign-in & security</h3><p>{user.google_connected?'Your Google account is connected. Sign in with Google whenever you return.':'Connect Google for a simpler sign-in experience.'}</p><div className="profile-login-status"><span className="google-letter">G</span><div><strong>Google account</strong><small>{user.google_connected?'Connected':'Not connected'}</small></div>{user.google_connected?<Check size={16}/>:null}</div>{!user.google_connected&&<button className="secondary full" disabled={!google} onClick={()=>window.location.assign(API+'/api/v1/auth/google/start?link=true')}>Connect Google<ExternalLink size={14}/></button>}{!google&&!user.google_connected&&<p className="profile-setup-note">Google sign-in is waiting for workspace configuration. See the <a href="/setup" target="_blank" rel="noreferrer">setup guide</a> to connect your OAuth client.</p>}<div className="profile-trust"><Mail size={14}/><span>{user.email}</span></div></div>
        <div className="panel profile-subscription"><div className="profile-card-icon"><Zap size={20}/></div><h3>Your subscription</h3><strong>{usage?.display_plan==='none'?'No active plan':`${(usage?.display_plan ?? user.plan).charAt(0).toUpperCase()+(usage?.display_plan ?? user.plan).slice(1)} plan`}</strong><div className="profile-credit-row"><span>Subscription tokens</span><b>{Number(usage?.subscription_tokens ?? 0).toLocaleString()}</b></div><div className="profile-credit-row"><span>Top-up tokens</span><b>{Number(usage?.topup_tokens ?? 0).toLocaleString()}</b></div><div className="profile-credit-row"><span>Token allowance</span><b>{Number(usage?.limits?.tokens ?? 0).toLocaleString()} / period</b></div><p>Subscription credits are used first. Top-up credits are used after them.</p><button className="primary full" onClick={onSubscribe}>Manage plans & usage<ArrowRight size={14}/></button></div>
      </div>
    </div>
    <section className="panel profile-danger" aria-labelledby="delete-account-heading">
      <div>
        <div className="profile-danger-badge"><AlertTriangle size={15}/> Danger zone</div>
        <h3 id="delete-account-heading">Delete account permanently</h3>
        <p>Permanently remove your account, profile, API keys, support tickets, and all agents, knowledge sources, workflows, and conversations. This action cannot be undone.</p>
      </div>
      <button type="button" className="danger profile-delete-trigger" disabled={checkingDelete||deleting} onClick={()=>void openDeleteModal()}>
        <Trash2 size={15}/>{checkingDelete?'Checking workspace…':'Delete account'}
      </button>
    </section>
    {deleteOpen&&<div className="app-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!deleting)setDeleteOpen(false);}}>
      <section className="app-dialog delete-account-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
        <button type="button" className="app-dialog-close" aria-label="Close dialog" disabled={deleting} onClick={()=>setDeleteOpen(false)}><X size={17}/></button>
        <div className="app-dialog-icon danger"><AlertTriangle size={21}/></div>
        <h2 id="delete-dialog-title">Permanently delete your account?</h2>
        <p>This will permanently delete <strong>{user.email}</strong> and all associated data. Once deleted, your account and workspace cannot be recovered.</p>
        {hasSubscriptionWarning&&<div className="delete-warning" role="alert">
          <CreditCard size={17}/>
          <div>
            <strong>Active subscription warning</strong>
            <p>
              {activeSummary.has_active_subscription
                ? `You currently have an active ${planName} subscription (${providerName}). Deleting your account will permanently cancel this subscription and immediately end all paid access and remaining token credits.`
                : activeSummary.has_paid_plan
                  ? `Your account is currently on the ${planName} plan. Deleting your account will immediately forfeit your remaining plan access and token credits.`
                  : `You have a pending ${providerName} subscription checkout. Deleting your account will discard it.`}
            </p>
          </div>
        </div>}
        {hasBotsWarning&&<div className="delete-warning" role="alert">
          <BotIcon size={17}/>
          <div>
            <strong>{activeSummary.published_bots>0?'Active & published bots warning':'Workspace bots warning'}</strong>
            <p>
              {activeSummary.published_bots>0
                ? `You have ${activeSummary.total_bots} ${activeSummary.total_bots===1?'bot':'bots'} (${activeSummary.published_bots} active and published). Deleting your account will permanently erase all bots, knowledge sources, workflows, and conversations, and live embedded widgets and hosted chat links will stop working immediately.`
                : `You have ${activeSummary.total_bots} ${activeSummary.total_bots===1?'bot':'bots'} in your workspace. Deleting your account will permanently erase all bots, knowledge sources, workflows, and conversations.`}
            </p>
            {activeSummary.bots&&activeSummary.bots.length>0&&<ul className="delete-bot-list">
              {activeSummary.bots.slice(0,4).map(bot=><li key={bot.id}><span>{bot.name}</span><em className={bot.published?'live':'draft'}>{bot.published?'Published':'Draft'}</em></li>)}
              {activeSummary.bots.length>4&&<li className="more">+{activeSummary.bots.length-4} more {activeSummary.bots.length-4===1?'bot':'bots'}</li>}
            </ul>}
          </div>
        </div>}
        <label className="app-dialog-input delete-confirm-input">
          Type <strong>DELETE</strong> to confirm permanent deletion
          <input value={confirmText} onChange={event=>setConfirmText(event.target.value)} placeholder="DELETE" autoFocus disabled={deleting} autoComplete="off"/>
        </label>
        {deleteError&&<div className="error delete-dialog-error" role="alert">{deleteError}</div>}
        <div className="app-dialog-actions">
          <button type="button" className="app-dialog-cancel" disabled={deleting} onClick={()=>setDeleteOpen(false)}>Cancel</button>
          <button type="button" className="app-dialog-confirm danger" disabled={deleting||confirmText.trim()!=='DELETE'} onClick={()=>void confirmPermanentDelete()}>
            {deleting?'Deleting account…':'Permanently delete account'}
          </button>
        </div>
      </section>
    </div>}
  </>;
}
