'use client';
import { use, useEffect, useState } from 'react';
import { Shell } from '../../../components/shell';
import { api, Notice, messageOf } from '../../../components/client';
import { SafetyLink } from '../../../components/safety';
type Profile = {
  displayName: string;
  age: number;
  intention: string;
  interests: string[];
  prompt: string;
  photos: { id: string }[];
};
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params),
    [profile, setProfile] = useState<Profile | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setProfile(null);
    void api<Profile>(`members/${id}`).then(
      (r) => {
        if (active) {
          setProfile(r);
          setError('');
        }
      },
      (e) => {
        if (active) setError(messageOf(e));
      },
    );
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <Shell member>
      <section className="dashboard form-stack">
        <h1>{profile ? `${profile.displayName}, ${profile.age}` : 'Profile'}</h1>
        <Notice error={error} />
        {profile && (
          <article className="panel">
            <div className="photo-grid">
              {profile.photos.map((p, i) => (
                <img
                  key={p.id}
                  width={240}
                  height={280}
                  src={`/api/v1/members/${id}/photos/${p.id}`}
                  alt={`Profile photo ${i + 1}`}
                />
              ))}
            </div>
            <h2>{profile.intention.replaceAll('-', ' ')}</h2>
            <p>{profile.interests.join(' · ')}</p>
            <p>{profile.prompt}</p>
          </article>
        )}
        <SafetyLink subjectId={id} surface="profile" />
      </section>
    </Shell>
  );
}
