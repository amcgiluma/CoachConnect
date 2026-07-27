import type { Coach } from '../data'

type CoachAvatarProps = {
  coach: Pick<Coach, 'name' | 'initials' | 'avatarUrl' | 'avatarAvifUrl'>
  className?: string
  eager?: boolean
  title?: string
}

export function CoachAvatar({ coach, className = '', eager = false, title }: CoachAvatarProps) {
  const classes = `coach-avatar ${className}`.trim()

  if (!coach.avatarUrl) return <span className={`${classes} coach-avatar-fallback`} title={title}>{coach.initials}</span>

  return (
    <picture className={classes} title={title}>
      {coach.avatarAvifUrl && <source srcSet={coach.avatarAvifUrl} type="image/avif" />}
      <img
        src={coach.avatarUrl}
        alt=""
        width="320"
        height="320"
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
    </picture>
  )
}
