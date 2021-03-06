import config from 'config';
import Resume from '../models/resumes';
import User from '../models/users';
import ResumePub from '../models/resume-pub';
import ShareAnalyse from '../models/share-analyse';
import getCacheKey from './helper/cacheKey';
import Downloads from '../services/downloads';
import dateHelper from '../utils/date';
import { getGithubSections } from './shared';

const URL = config.get('url');
const getResume = async (ctx, next) => {
  const userId = ctx.session.userId;
  const getResult = await Resume.getResume(userId);
  const { message, result } = getResult;
  ctx.body = {
    success: true,
    result
  };
};

const setResume = async (ctx, next) => {
  const { resume } = ctx.request.body;
  const { userId } = ctx.session;

  const setResult = await Resume.updateResume(userId, resume);
  let resumeInfo = null;
  if (setResult.success) {
    // check & add resume share info
    let checkResult = await ResumePub.findPublicResume({ userId });
    if (!checkResult.success) {
      checkResult = await ResumePub.addPubResume(userId);
    }
    resumeInfo = checkResult.success ? {
      url: `resume/${checkResult.result.resumeHash}?locale=${ctx.session.locale}`,
      useGithub: checkResult.result.useGithub,
      openShare: checkResult.result.openShare
    } : null;
  }

  const checkPubResume = await ResumePub.findPublicResume({ userId });
  if (checkPubResume.success) {
    const hash = checkPubResume.result.resumeHash;
    const cacheKey = getCacheKey(ctx);
    ctx.query.deleteKeys = [
      cacheKey(`resume.${hash}`)
    ];
  }

  ctx.body = {
    success: true,
    message: ctx.__("messages.success.save"),
    result: resumeInfo
  };

  await next();
};

const downloadResume = async (ctx, next) => {
  const { hash } = ctx.query;
  const { userId, githubLogin } = ctx.session;
  const { result } = await ResumePub.getUpdateTime(hash);
  const seconds = dateHelper.getSeconds(result);

  const resumeUrl = `${URL}/resume/${hash}?locale=${ctx.session.locale}&userId=${userId}&notrace=true`;
  const resultUrl = await Downloads.resume(resumeUrl, {
    folder: githubLogin,
    title: `${seconds}-resume.pdf`
  });

  ctx.body = {
    result: resultUrl,
    success: true
  };
};

const getPubResume = async (ctx, next) => {
  const { hash } = ctx.query;
  const findResume = await ResumePub.getPubResume(hash);
  const { success, result, message } = findResume;

  ctx.body = {
    message,
    result,
    success: true
  };

  await next();
};

const getPubResumePage = async (ctx, next) => {
  const { hash } = ctx.params;
  const targetUserId = ctx.query.userId;
  if (targetUserId) {
    ctx.session.fromDownload = true;
  }

  const findResume = await ResumePub.checkPubResume({
    resumeHash: hash
  }, {
    userId: targetUserId
  });

  const { success, result } = findResume;
  if (!success) {
    ctx.redirect('/404');
    return;
  }

  const { name, userId } = result;
  const user = await User.findUserById(userId);

  await ctx.render('resume/share', {
    title: ctx.__("resumePage.title", name),
    resumeHash: hash,
    login: user.githubInfo.login
  });
};

const getResumeShareStatus = (findPubResume, locale) => {
  const { result, success, message } = findPubResume;
  if (!success) {
    return {
      error: message,
      success: true,
      result: null
    };
  }

  const { useGithub, resumeHash, openShare, github } = result;
  return {
    success: true,
    result: {
      github,
      openShare,
      useGithub,
      resumeHash,
      url: `resume/${resumeHash}?locale=${locale}`,
      githubUrl: null
    }
  }
};

const getPubResumeStatus = async (ctx, next) => {
  const { hash } = ctx.params;
  const { fromDownload, locale } = ctx.session;
  const findPubResume = await ResumePub.findPublicResume({ resumeHash: hash });
  const shareResult = getResumeShareStatus(findPubResume, locale);

  const { success, result } = shareResult;
  if (success && result && fromDownload) {
    const { userId } = findPubResume.result;
    const user = await User.findUserById(userId);
    shareResult.result.githubUrl = `${URL}/github/${user.githubLogin}?locale=${locale}`;
    ctx.session.fromDownload = null;
  }

  return ctx.body = shareResult;
};

const getResumeStatus = async (ctx, next) => {
  const { userId, locale } = ctx.session;
  const findPubResume = await ResumePub.findPublicResume({ userId });

  return ctx.body = getResumeShareStatus(findPubResume, locale);
};

const setResumeShareStatus = async (ctx, next) => {
  const { enable } = ctx.request.body;
  const { userId } = ctx.session;
  const findPubResume = await ResumePub.findPublicResume({ userId });
  const { result, success, message } = findPubResume;
  if (!success) {
    return ctx.body = {
      error: message,
      success: true
    };
  }
  await ResumePub.updatePubResume(userId, result.resumeHash, {
    openShare: enable
  });
  const resultMessage = Boolean(enable) == true ? "messages.share.toggleOpen" : "messages.share.toggleClose";
  ctx.body = {
    success: true,
    message: ctx.__(resultMessage)
  };
};

const setResumeGithubStatus = async (ctx, next) => {
  const { enable } = ctx.request.body;
  const { userId } = ctx.session;
  const findPubResume = await ResumePub.findPublicResume({ userId });
  const { result, success, message } = findPubResume;
  if (!success) {
    return ctx.body = {
      error: message,
      success: true
    };
  }
  await ResumePub.updatePubResume(userId, result.resumeHash, {
    useGithub: enable
  });
  const resultMessage = Boolean(enable) == true ? "messages.resume.linkGithub" : "messages.resume.unlinkGithub";
  ctx.body = {
    success: true,
    message: ctx.__(resultMessage)
  };
};

const setGithubShareSection = async (ctx, next) => {
  const { userId } = ctx.session;
  const findPubResume = await ResumePub.findPublicResume({ userId });
  const { result, success, message } = findPubResume;
  if (!success) {
    return ctx.body = {
      error: message,
      success: true
    };
  }

  const githubSections = getGithubSections(ctx.request.body);

  await ResumePub.updatePubResume(userId, result.resumeHash, {
    github: Object.assign({}, result.github, githubSections)
  });
  ctx.body = {
    success: true
  };
};

const getShareRecords = async (ctx, next) => {
  const { userId } = ctx.session;
  const findPubResume = await ResumePub.findPublicResume({ userId });
  const { result, success, message } = findPubResume;
  if (!success) {
    ctx.body = {
      error: message,
      success: true,
      result: {
        url: '',
        viewDevices: [],
        viewSources: [],
        pageViews: [],
        openShare: false
      }
    };
    return;
  }

  const shareAnalyse = await ShareAnalyse.findShare({ url: `resume/${result.resumeHash}`, userId });
  const { viewDevices, viewSources, pageViews } = shareAnalyse;
  ctx.body = {
    success: true,
    result: {
      url: `resume/${result.resumeHash}?locale=${ctx.session.locale}`,
      openShare: result.openShare,
      viewDevices,
      viewSources,
      pageViews,
    }
  };
};

export default {
  getResume,
  setResume,
  downloadResume,
  getPubResume,
  getPubResumePage,
  getResumeStatus,
  getPubResumeStatus,
  setResumeShareStatus,
  setResumeGithubStatus,
  setGithubShareSection,
  getShareRecords
}
