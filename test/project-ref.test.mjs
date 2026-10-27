import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectRef, recordsProject } from '../web/src/shared/project.ts';

test('a plain project identifier is read from the query string', () => {
  assert.equal(projectRef('?project=proj_42'), 'proj_42');
  assert.equal(projectRef('?a=1&project=Alpha-7'), 'Alpha-7');
  assert.equal(projectRef('project=abc'), 'abc');
});

test('anything else is ignored rather than trusted', () => {
  for (const search of ['', '?', '?project=', '?other=1', '?project=a&project=b', '?project=has space', '?project=../x', '?project=a%2Fb',
    '?project=-leading', `?project=${'a'.repeat(65)}`, '?project=<script>']) assert.equal(projectRef(search), null, search);
});

test('the project is recorded only when the contract declares it', () => {
  assert.equal(recordsProject({ submission: 1, amount: 2 }), false);
  assert.equal(recordsProject({ submission: 1, project: 3 }), true);
});
