/**
 * Pseudo-rule for metadata extraction: profile.
 */

// Settings:
const SELECTOR_SUBTITLE = 'body div.head h2';

// External packages:
const PowerPromise = require('promise');

// Internal packages:
const rules = require('../../rules');
const sua = require('../../throttled-ua');

// 'self.name' would be 'metadata.profile'
exports.name = 'metadata.profile';

exports.check = function (sr, done) {
    let matchedLength = 0;
    let id;
    let profileNode;
    const reviewStatus = new Map();
    let amended = false;
    sr.jsDocument.querySelectorAll(SELECTOR_SUBTITLE).forEach((element) => {
        const candidate = sr.norm(element.textContent).toLowerCase();
        for (const t in rules)
            if (t !== '*')
                for (const p in rules[t].profiles) {
                    const name = rules[t].profiles[p].name.toLowerCase();
                    if (
                        candidate.indexOf(name) !== -1 &&
                        matchedLength < name.length
                    ) {
                        id = p;
                        profileNode = element;
                        amended = candidate.endsWith('(amended by w3c)');
                        matchedLength = name.length;
                    }
                }
    });

    reviewStatus.set('CR', 'implementationFeedbackDue');
    reviewStatus.set('PR', 'prReviewsDue');

    function assembleMeta(id, sr) {
        let meta = { profile: id };
        if (reviewStatus.has(id)) {
            const dueDate = sr.getFeedbackDueDate();
            const dates = dueDate && dueDate.valid;
            let res = dates[0];
            if (dates.length === 0 || !res) return done({ profile: id });
            if (dates.length > 1) res = new Date(Math.min.apply(null, dates));

            const d = [
                res.getFullYear(),
                res.getMonth() + 1,
                res.getDate(),
            ].join('-');
            meta[reviewStatus.get(id)] = d;
        }
        if (amended) meta.amended = amended;

        // implementation report
        if (['CR', 'CRD', 'PR', 'REC'].indexOf(id) > -1) {
            const dl = sr.jsDocument.querySelector('body div.head dl');
            const dts = sr.extractHeaders(dl);
            if (dts.Implementation) {
                meta.implementationReport = dts.Implementation.dd.querySelector(
                    'a'
                ).href;
            }
        }
        if (id === 'REC') {
            meta = sr.getRecMetadata(meta);
        }
        return done(meta);
    }

    const checkPreviousVersion = function (sr) {
        return new PowerPromise((resolve) => {
            const dl = sr.jsDocument.querySelector('body div.head dl');
            const dts = sr.extractHeaders(dl);
            const linkPrev = dts.Previous
                ? dts.Previous.dd.querySelector('a')
                : '';

            let specExists;

            const linkLatest = dts.Latest
                ? dts.Latest.dd.querySelector('a').getAttribute('href')
                : '';
            const shortnameReg = /^https:\/\/www.w3.org\/TR\/(.+)\/$/;
            const shortname =
                linkLatest.match(shortnameReg) &&
                linkLatest.match(shortnameReg)[1];
            const req = sua
                .get(`https://api.w3.org/specifications/${shortname}`)
                .set('User-Agent', `W3C-Pubrules/${sr.version}`);
            req.query({ apikey: process.env.W3C_API_KEY });
            req.end((err, res) => {
                if (err || !res.ok) {
                    specExists = false;
                } else {
                    specExists = true;
                }
                resolve(specExists || linkPrev);
            });
        });
    };
    const checkRecType = function () {
        if (
            profileNode &&
            profileNode.textContent.indexOf('Candidate Recommendation') > 0
        ) {
            return profileNode.textContent.indexOf('Draft') > 0 ? 'CRD' : 'CR';
        }
        return 'REC';
    };

    if (id) {
        if (/-NOTE/.test(id)) {
            checkPreviousVersion(sr).then((hasPreviousVersion) => {
                // for First Public notes: WG-NOTE -> FPWG-NOTE
                id = hasPreviousVersion ? id : `FP${id}`;
                assembleMeta(id, sr);
            });
        } else {
            // W3C Candidate Recommendation (CR before 2020/CR snapshot/CR draft), W3C Recommendation will have "REC"
            if (id === 'REC' || id === 'CR') {
                // distingush REC CR CRD
                id = checkRecType(sr);
            }
            assembleMeta(id, sr);
        }
    } else {
        throw new Error(
            "[EXCEPTION] The document could not be parsed, it's neither a TR document nor a Member Submission."
        );
    }
};
