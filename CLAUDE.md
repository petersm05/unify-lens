# Working on Unify Lens

For what the code expects — the rules, the compiler settings, what is
deliberate and what is a defect — read
[`.github/copilot-instructions.md`](.github/copilot-instructions.md). It is
written for a reviewer, and it is just as true for whoever is writing the
change. This file is about the procedure around it.

## Every change goes through a pull request

Branch from the current `main`, one concern per branch. Push, open a pull
request, then:

1. **Review it** — run the `code-review` skill against the pull request number.
2. **Fix what it finds**, or say why a finding is wrong. Both are answers;
   ignoring one is not.
3. **Re-run the review.** A pass over the previous diff says nothing about the
   one that replaced it, and the fixes are the part most likely to be hasty.
4. Repeat until it comes back clean, then hand it over as ready to merge.

Merging is the maintainer's. So is anything the review raises that turns out to
be a product decision rather than a defect — those go to them, not into the
branch.

### Review-clean is not the same as mergeable

The two checks catch different things, and both have been the only one to catch
something real:

- **CI** found the test that reached the SDK, which failed two deploys and left
  the site on a stale build. A reading of the diff would not have seen it.
- **The review** found three tests that asserted nothing — a timezone-dependent
  fixture, a test that passed with the behaviour it named removed, and a
  comparison of `undefined` with `undefined`. CI passed all three happily.

So the gate is both, plus the maintainer's judgement. Neither replaces the
other, and a green review is not permission to skip a red pipeline.

### Verify the fix, not the file

"The suite fails when I break the code" is not evidence that the test for that
behaviour works — some *other* test may be doing the catching. Check which test
failed and for what reason. That mistake shipped three inert tests here, and
the review caught them rather than the mutation run that was supposed to.

## Two ways pull requests have gone wrong here

**Do not stack a pull request on another branch.** It has been tried twice and
gone wrong twice: one merged into a base branch that was itself already merged,
so the change was "merged" into a dead end and never reached `main`; the other
put follow-up work on top of already-merged history. Where two changes touch
the same lines, land the first and rebase the second onto `main`.

**A merged pull request is finished.** Follow-up work starts from `main` again,
on a fresh branch, as a new pull request.

## Watch what you shipped

`pages.yml` deploys on every push to `main` and runs the tests before it
builds, so a failing test costs a publish rather than shipping a broken one.
That is the right trade, and it means a red pipeline stops the site updating
while appearing to succeed from the outside. After a merge, check the run
rather than assuming — twice the deploy was red for the better part of an hour
before anyone looked.
