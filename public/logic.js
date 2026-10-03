export function totals(s){
 const rows=s.rows.filter(r=>r.taxYear===2026);
 const personal=s.personalOpening+rows.reduce((a,r)=>a+(r.personal??0),0);
 const employer=s.employerOpening+rows.reduce((a,r)=>a+(r.employer??0),0);
 const reserve=Math.max(0,s.employerAnnual-employer);
 const room=s.limit-personal-employer-reserve;
 const remaining=rows.filter(r=>r.personal===null).length;
 return {personal,employer,reserve,room,remaining,combined:personal+employer,suggested:remaining?Math.max(0,Math.floor(room/remaining)):0};
}
export function cents(value){if(!/^\d+(\.\d{1,2})?$/.test(value))throw Error('Enter a nonnegative amount with up to two decimal places.');const [a,b='']=value.split('.');const result=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(result)||result>10000000)throw Error('Amount is too large.');return result;}
