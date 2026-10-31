// When does the player hear that sync is not working? Every failure is kept on the menu card,
// but a player who is playing never sees the card, so some are told at once as a notice. The
// rules, so that a notice is neither missing nor a nuisance:
//
//   cloud     a round of the cloud that no server answered. Told after the second one in a row
//             (one miss is a bad moment), or at once when the player asked for it (Sync now, a
//             phrase). Told again only after RENOTICE_MS of failing. When it works again after a
//             notice, one short notice says so. Failures while the device is offline are not
//             counted: nothing is wrong, and it tries again when the network is back.
//   refused   the servers answered and refused the data (denied, rejected, unauthorized), and
//             toobig: the data does not fit one slice. These do not pass by themselves, so they
//             are told at once, once per RENOTICE_MS.
//   meet      two linked devices were both open and could not connect or trade (not the case
//             that the other device is simply not open): told after the second in a row.
//   link      a link that was made or opened did not work: told when the card is not on screen
//             (the card says it itself).
//
// notify(event) gets { kind, code? }: 'cloud-failed' | 'cloud-refused' | 'cloud-toobig' |
// 'cloud-recovered' | 'meet-failed' | 'link-failed' (with `reason`). Pure: no DOM, no timers.
export const FAILS_BEFORE_NOTICE = 2;
export const RENOTICE_MS = 6 * 60 * 60 * 1000;
const REFUSED = new Set(['denied', 'rejected', 'unauthorized']);

export function createHealth({ notify, now = () => Date.now(), online = () => true }) {
  const cloud = { fails: 0, noticed: false, at: 0 };
  const meet = { fails: 0, noticed: false, at: 0 };
  const due = track => !track.noticed || now() - track.at >= RENOTICE_MS;
  const tell = (track, event) => {
    track.noticed = true;
    track.at = now();
    notify(event);
  };

  return {
    // A cloud round gave something (or there was nothing to do).
    cloudOk() {
      const wasTold = cloud.noticed;
      cloud.fails = 0;
      cloud.noticed = false;
      if (wasTold) {
        notify({ kind: 'cloud-recovered' });
      }
    },
    // A cloud round got no answer: error = the code of cloud.js status (network, busy, closed,
    // denied, rejected, unauthorized, toobig); manual = the player asked for this round.
    cloudFailed({ error = 'network', manual = false } = {}) {
      if (error === 'toobig' || REFUSED.has(error)) {
        if (due(cloud)) {
          const kind = error === 'toobig' ? 'cloud-toobig' : 'cloud-refused';
          tell(cloud, { kind, code: error });
        }
        return;
      }
      if (!online()) {
        return;
      }
      cloud.fails += 1;
      if ((manual || cloud.fails >= FAILS_BEFORE_NOTICE) && due(cloud)) {
        tell(cloud, { kind: 'cloud-failed', code: error });
      }
    },
    meetOk() {
      meet.fails = 0;
      meet.noticed = false;
    },
    meetFailed({ reason = 'connect' } = {}) {
      if (!online()) {
        return;
      }
      meet.fails += 1;
      if (meet.fails >= FAILS_BEFORE_NOTICE && due(meet)) {
        tell(meet, { kind: 'meet-failed', code: reason });
      }
    },
    // seen: the menu card is on screen and shows it.
    linkFailed({ reason = 'connect', seen = false } = {}) {
      if (!seen) {
        notify({ kind: 'link-failed', reason });
      }
    },
  };
}
