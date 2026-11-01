# Vercel runs this before each build of the site: exit 0 skips the build, exit 1 builds.
# It skips only when nothing in site/ changed since this branch's last deploy, so app-only
# commits don't redeploy the site. A branch's first deploy, or one Vercel can't compare, builds.
prev="$VERCEL_GIT_PREVIOUS_SHA"
{ [ -n "$prev" ] && git cat-file -e "$prev^{commit}" 2>/dev/null; } || exit 1
git diff --quiet "$prev" HEAD -- .
