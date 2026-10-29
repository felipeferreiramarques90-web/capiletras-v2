// Campo único com prefixo protegido. O input guarda o texto completo; apenas
// getAdded() sai para a rede. O espelho colorido não é outro campo editável.
export const CHALLENGE_UI = Object.freeze({ urgentSeconds: 10 });
export function protectChallengeField(input, mirror, onChange) {
  let prefix='', added='', limit=16, editable=false;
  const clean=text=>String(text||'').replace(/[^A-Za-z]/g,'').toUpperCase();
  const end=()=>{if(input.selectionStart!==input.value.length || input.selectionEnd!==input.value.length) input.setSelectionRange(input.value.length,input.value.length);};
  function paint(notify=false) {
    input.value=prefix+added;
    const base=document.createElement('span'),extra=document.createElement('span');
    base.className='challenge-prefix';base.textContent=prefix;extra.className='challenge-added';extra.textContent=added;
    mirror.replaceChildren(base,extra);input.readOnly=!editable;
    end();input.scrollLeft=input.scrollWidth;mirror.scrollLeft=input.scrollLeft;
    if(notify)onChange(added);
  }
  function append(text){added=(added+clean(text)).slice(0,limit);paint(true);}
  input.addEventListener('beforeinput',event=>{
    if(!editable){event.preventDefault();return;}
    if(event.isComposing)return;
    const type=event.inputType;
    if(type.startsWith('delete')){event.preventDefault();if(type.includes('Backward'))added=type.includes('Word')?'':added.slice(0,-1);paint(true);}
    else if(type.startsWith('insert') && event.data!==null){event.preventDefault();
      if(type==='insertReplacementText'){const value=clean(event.data);added=(value.startsWith(prefix)?value.slice(prefix.length):value).slice(0,limit);paint(true);}
      else append(event.data);
    }
  });
  input.addEventListener('input',()=>{
    if(!editable){paint();return;}
    if(input.value.startsWith(prefix))added=clean(input.value.slice(prefix.length)).slice(0,limit);
    paint(true);
  });
  input.addEventListener('compositionend',()=>{if(editable && input.value.startsWith(prefix))added=clean(input.value.slice(prefix.length)).slice(0,limit);paint(true);});
  for(const eventName of ['paste','drop'])input.addEventListener(eventName,event=>{
    event.preventDefault();if(editable)append((event.clipboardData||event.dataTransfer)?.getData('text/plain'));
  });
  input.addEventListener('cut',event=>event.preventDefault());
  input.addEventListener('keydown',event=>{
    if(['Home','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a')){event.preventDefault();end();}
  });
  for(const event of ['focus','click','pointerup','select'])input.addEventListener(event,end);
  document.addEventListener('selectionchange',()=>{if(document.activeElement===input)end();});
  return { getAdded:()=>added,
    set(base,text,max,canEdit){prefix=base;added=clean(text).slice(0,max);limit=max;editable=canEdit;paint();},
    setEditable(value){editable=value;input.readOnly=!value;},
  };
}
