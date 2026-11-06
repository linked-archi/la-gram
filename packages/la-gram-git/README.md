# la-gram-git

la-gram's architecture models in Git — checked, rewritten as la-gram writes
them, compared by element, merged by element — on the command line and in CI.
Built from la-gram's own engine, so it says of a model file what la-gram would.

```sh
npx @linked-archi/la-gram-git check --base origin/main   # in CI: fails a broken change
npx @linked-archi/la-gram-git diff origin/main --comment # the change by element, on the request
npx @linked-archi/la-gram-git init github                # or gitlab, or merge-driver
```

`la-gram-git --help` lists the commands. Licensed under the Apache License 2.0;
the metamodel files under `assets/` are Linked.Archi's, each under the licence
it states.
