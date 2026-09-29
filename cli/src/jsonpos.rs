//! Where the members of a JSON document are, for diagnostics only. The
//! validators of the schema crate decide; they report a category without a
//! position, and this scanner finds the member the category names. It is
//! lenient and never fails: an unexpected byte ends the scan.

/// One object member: its dotted path (`permissions.network.0`), the byte
/// offset of its key and the byte offset of its value.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Member {
    pub path: String,
    pub key: usize,
    pub value: usize,
}

/// Depth past which the scan stops; manifests and locales are shallow.
const MAX_DEPTH: usize = 32;

pub fn members(text: &str) -> Vec<Member> {
    let mut scanner = Scanner {
        bytes: text.as_bytes(),
        at: 0,
        out: Vec::new(),
    };
    scanner.value("", 0);
    scanner.out
}

/// The member at `path`, or its closest existing ancestor.
pub fn find(text: &str, path: &str) -> Option<Member> {
    let all = members(text);
    let mut path = path;
    loop {
        if let Some(member) = all.iter().find(|member| member.path == path) {
            return Some(member.clone());
        }
        path = &path[..path.rfind('.')?];
    }
}

struct Scanner<'a> {
    bytes: &'a [u8],
    at: usize,
    out: Vec<Member>,
}

impl Scanner<'_> {
    fn skip_space(&mut self) {
        while self.bytes.get(self.at).is_some_and(u8::is_ascii_whitespace) {
            self.at += 1;
        }
    }

    fn value(&mut self, path: &str, depth: usize) -> Option<()> {
        if depth > MAX_DEPTH {
            return None;
        }
        self.skip_space();
        match self.bytes.get(self.at)? {
            b'{' => {
                self.at += 1;
                loop {
                    self.skip_space();
                    match self.bytes.get(self.at)? {
                        b'}' => {
                            self.at += 1;
                            return Some(());
                        }
                        b',' => self.at += 1,
                        b'"' => {
                            let key_at = self.at;
                            let key = self.string()?;
                            self.skip_space();
                            if self.bytes.get(self.at)? != &b':' {
                                return None;
                            }
                            self.at += 1;
                            self.skip_space();
                            let child = join(path, &key);
                            self.out.push(Member {
                                path: child.clone(),
                                key: key_at,
                                value: self.at,
                            });
                            self.value(&child, depth + 1)?;
                        }
                        _ => return None,
                    }
                }
            }
            b'[' => {
                self.at += 1;
                let mut index = 0usize;
                loop {
                    self.skip_space();
                    match self.bytes.get(self.at)? {
                        b']' => {
                            self.at += 1;
                            return Some(());
                        }
                        b',' => self.at += 1,
                        _ => {
                            let child = join(path, &index.to_string());
                            self.out.push(Member {
                                path: child.clone(),
                                key: self.at,
                                value: self.at,
                            });
                            self.value(&child, depth + 1)?;
                            index += 1;
                        }
                    }
                }
            }
            b'"' => self.string().map(|_| ()),
            _ => {
                while self.bytes.get(self.at).is_some_and(|byte| {
                    !matches!(byte, b',' | b'}' | b']') && !byte.is_ascii_whitespace()
                }) {
                    self.at += 1;
                }
                Some(())
            }
        }
    }

    /// A string starting at `self.at`; escapes are kept undecoded except
    /// `\"` and `\\`, which is enough to match member names.
    fn string(&mut self) -> Option<String> {
        self.at += 1;
        let mut out = Vec::new();
        loop {
            match *self.bytes.get(self.at)? {
                b'"' => {
                    self.at += 1;
                    return String::from_utf8(out).ok();
                }
                b'\\' => {
                    let escaped = *self.bytes.get(self.at + 1)?;
                    out.push(escaped);
                    self.at += 2;
                }
                byte => {
                    out.push(byte);
                    self.at += 1;
                }
            }
        }
    }
}

fn join(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.to_owned()
    } else {
        format!("{path}.{key}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_nested_members_and_falls_back_to_ancestors() {
        let text =
            "{\n  \"id\": \"a.b\",\n  \"permissions\": {\"network\": [{\"origin\": \"x\"}]}\n}";
        let id = find(text, "id").expect("id");
        assert_eq!(&text[id.key..id.key + 4], "\"id\"");
        assert_eq!(&text[id.value..id.value + 5], "\"a.b\"");
        let rule = find(text, "permissions.network.0.origin").expect("origin");
        assert_eq!(&text[rule.key..rule.key + 8], "\"origin\"");
        let missing = find(text, "permissions.storage").expect("ancestor");
        assert_eq!(missing.path, "permissions");
        assert!(find(text, "nothing").is_none());
    }

    #[test]
    fn stops_quietly_on_malformed_text() {
        assert_eq!(
            members("{\"a\": 1, \"b\": [1, "),
            vec![
                Member {
                    path: "a".into(),
                    key: 1,
                    value: 6
                },
                Member {
                    path: "b".into(),
                    key: 9,
                    value: 14
                },
                Member {
                    path: "b.0".into(),
                    key: 15,
                    value: 15
                },
            ]
        );
    }
}
