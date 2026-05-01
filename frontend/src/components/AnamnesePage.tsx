import { useEffect, useState } from "react";
import { getUserProfile, updateUserProfile } from "../api";
import type { UserProfile, UserSex } from "../types";

const EMPTY_PROFILE: UserProfile = {
  name: null,
  birthday: null,
  sex: null,
  known_diseases: null,
  former_health_conditions: null,
  life_events: null,
  interests: null,
  self_characterisation: null,
  admired: null,
  disliked: null,
  updated_at: null,
};

const SEX_OPTIONS: { value: UserSex; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

function formatSavedAt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

export function AnamnesePage() {
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    getUserProfile()
      .then((p) => {
        setProfile(p);
        setSavedAt(p.updated_at);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  function update<K extends keyof UserProfile>(key: K, value: UserProfile[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  function textValue(v: string | null): string {
    return v ?? "";
  }

  function setText<K extends keyof UserProfile>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const v = e.target.value;
      update(key, (v === "" ? null : v) as UserProfile[K]);
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const saved = await updateUserProfile({
        name: profile.name,
        birthday: profile.birthday,
        sex: profile.sex,
        known_diseases: profile.known_diseases,
        former_health_conditions: profile.former_health_conditions,
        life_events: profile.life_events,
        interests: profile.interests,
        self_characterisation: profile.self_characterisation,
        admired: profile.admired,
        disliked: profile.disliked,
      });
      setProfile(saved);
      setSavedAt(saved.updated_at);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="journal-page">
        <div className="trends-header"><h2>Anamnese</h2></div>
        <p>Loading…</p>
      </div>
    );
  }

  const savedLabel = formatSavedAt(savedAt);

  return (
    <div className="journal-page">
      <div className="trends-header">
        <h2>Anamnese</h2>
      </div>
      <section className="card">
        <p className="journal-hint" style={{ marginBottom: 16 }}>
          A short personal sketch — the AI assistant uses this to frame its briefings and analyses.
          Toggle the "Personal profile" category in Settings → AI Context to opt out at any time.
        </p>
        <form className="journal-form" onSubmit={save}>
          <div className="journal-field">
            <label htmlFor="anamnese-name">Name</label>
            <input
              id="anamnese-name"
              type="text"
              value={textValue(profile.name)}
              onChange={setText("name")}
              autoComplete="name"
            />
          </div>

          <div className="journal-field">
            <label htmlFor="anamnese-birthday">Birthday</label>
            <input
              id="anamnese-birthday"
              type="date"
              value={textValue(profile.birthday)}
              onChange={setText("birthday")}
            />
          </div>

          <fieldset className="journal-field">
            <legend>Sex</legend>
            <div>
              {SEX_OPTIONS.map((o) => (
                <label key={o.value} className="journal-radio">
                  <input
                    type="radio"
                    name="anamnese-sex"
                    value={o.value}
                    checked={profile.sex === o.value}
                    onChange={() => update("sex", o.value)}
                  />
                  {o.label}
                </label>
              ))}
              <label className="journal-radio">
                <input
                  type="radio"
                  name="anamnese-sex"
                  value=""
                  checked={profile.sex === null}
                  onChange={() => update("sex", null)}
                />
                Not specified
              </label>
            </div>
          </fieldset>

          <div className="journal-field">
            <label htmlFor="anamnese-known-diseases">Known diseases</label>
            <textarea
              id="anamnese-known-diseases"
              value={textValue(profile.known_diseases)}
              onChange={setText("known_diseases")}
              placeholder="Current diagnoses, chronic conditions, allergies."
            />
          </div>

          <div className="journal-field">
            <label htmlFor="anamnese-former-conditions">Former serious health conditions</label>
            <textarea
              id="anamnese-former-conditions"
              value={textValue(profile.former_health_conditions)}
              onChange={setText("former_health_conditions")}
              placeholder="Surgeries, hospitalisations, severe illnesses you've recovered from."
            />
          </div>

          <div className="journal-field">
            <label htmlFor="anamnese-life-events">
              Life-changing events &amp; how you dealt with them
            </label>
            <textarea
              id="anamnese-life-events"
              value={textValue(profile.life_events)}
              onChange={setText("life_events")}
              placeholder="Major events that shaped you and how you came through them."
            />
          </div>

          <div className="journal-field">
            <label htmlFor="anamnese-interests">Interests</label>
            <textarea
              id="anamnese-interests"
              value={textValue(profile.interests)}
              onChange={setText("interests")}
              placeholder="Hobbies, fields you follow, sports you do."
            />
          </div>

          <div className="journal-field">
            <label htmlFor="anamnese-self">Self-characterisation</label>
            <textarea
              id="anamnese-self"
              value={textValue(profile.self_characterisation)}
              onChange={setText("self_characterisation")}
              placeholder="How you'd describe yourself — temperament, strengths, quirks."
            />
          </div>

          <div className="journal-field">
            <label htmlFor="anamnese-admired">Things / persons you admire</label>
            <textarea
              id="anamnese-admired"
              value={textValue(profile.admired)}
              onChange={setText("admired")}
            />
          </div>

          <div className="journal-field">
            <label htmlFor="anamnese-disliked">Things / persons you dislike</label>
            <textarea
              id="anamnese-disliked"
              value={textValue(profile.disliked)}
              onChange={setText("disliked")}
            />
          </div>

          <div className="journal-actions">
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            {err && <span className="journal-err">{err}</span>}
            {!err && savedLabel && (
              <span className="journal-hint">Last saved {savedLabel}</span>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
