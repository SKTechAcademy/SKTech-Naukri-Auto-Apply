export async function enrichJob(context, job) {
  const page = await context.newPage();
  try {
    await page.goto(job.url,{waitUntil:'domcontentloaded',timeout:20000});
    await page.waitForFunction(()=>/job description/i.test(document.body.innerText)||!!document.querySelector('[class*="job-desc"], [class*="dang-inner-html"]'),null,{timeout:6000}).catch(()=>{});
    const detail=await page.evaluate(()=>{
      const text=document.body.innerText;
      const start=text.search(/job description/i);
      let description='';
      if(start>=0){const tail=text.slice(start);const end=tail.search(/about company|jobs you might|similar jobs|recommended jobs/i);description=end>0?tail.slice(0,end):tail.slice(0,18000);}
      else description=Array.from(document.querySelectorAll('[class*="job-desc"], [class*="dang-inner-html"]')).map(el=>el.innerText).filter(Boolean).join('\n');
      const experience=text.slice(0,2500).match(/\b\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:years|yrs)/i)?.[0]||'';
      const postedText = text.match(/\bPosted\s*:\s*((?:(?:\d+\+?|a|an|few)\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\s*ago|today|yesterday|just now))/i)?.[1] || '';
      return {description,experience,postedText};
    });
    return {...job,postedText:detail.postedText||job.postedText,description:detail.description||job.description,experience:job.experience||detail.experience,detailChecked:!!detail.description};
  }finally{await page.close().catch(()=>{});}
}
