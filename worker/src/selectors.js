// Keep selectors isolated because job-site UIs change frequently.
export const selectors = {
  loginIndicator: 'a[href*="logout"], .nI-gNb-drawer__icon',
  jobCard: '.srp-jobtuple-wrapper, .jobTuple',
  jobTitle: 'a.title, .title',
  jobDescription: '.job-desc, .job-description',
  location: '.locWdth, .location',
  experience: '.expwdth, .experience',
  applyButton: 'button:has-text("Apply"), a:has-text("Apply"), button:has-text("Apply Now")',
  alreadyApplied: 'text=/already applied/i'
};
