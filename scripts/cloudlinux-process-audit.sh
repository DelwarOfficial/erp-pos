#!/bin/bash

echo "RESOURCE_LIMITS"
ulimit -u

read -r uptime_seconds _ < /proc/uptime
uptime_seconds=${uptime_seconds%.*}
process_count=0

echo "TARGET_PROCESSES"
for proc in /proc/[0-9]*; do
  [[ -r "$proc/stat" ]] || continue
  ((process_count += 1))

  read -r -a stat_fields < "$proc/stat" || continue
  pid=${stat_fields[0]}
  state=${stat_fields[2]}
  ppid=${stat_fields[3]}
  start_ticks=${stat_fields[21]}
  age_seconds=$((uptime_seconds - start_ticks / 100))

  comm=""
  read -r comm < "$proc/comm" || true
  case "$comm" in
    *prisma*|*schema-engine*|*query-engine*)
      parent_exists=yes
      [[ -d "/proc/$ppid" ]] || parent_exists=no
      printf 'pid=%s ppid=%s parent_exists=%s state=%s start_ticks=%s age_seconds=%s comm=%q\n' \
        "$pid" "$ppid" "$parent_exists" "$state" "$start_ticks" "$age_seconds" "$comm"
      ;;
  esac
done

echo "PROCESS_COUNT $process_count"
