import sys
import xml.etree.ElementTree as ET
import math

# --- TUNING CONSTANTS ---
CLIMB_FATIGUE_THRESHOLD = 300
CLIMB_MAX_FATIGUE = 900  
CLIMB_RESTING_GRADIENT_PERCENT = 0.5
# THE FIX: Allow the rider to catch their breath much faster on flats
CLIMB_RECOVERY_MULTIPLIER = 0.4  
CLIMB_SMOOTHING_WINDOW_SIZE = 5
CLIMB_MIN_GAIN_METERS = 15
CLIMB_MIN_AVERAGE_GRADE_PERCENT = 1.5  

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi/2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2.0)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def parse_gpx(file_path):
    tree = ET.parse(file_path)
    root = tree.getroot()
    ns = {'gpx': 'http://www.topografix.com/GPX/1/1'}
    route = []
    total_dist = 0.0
    
    trkpts = root.findall('.//gpx:trkpt', ns)
    for i, pt in enumerate(trkpts):
        lat = float(pt.attrib['lat'])
        lon = float(pt.attrib['lon'])
        ele_elem = pt.find('gpx:ele', ns)
        ele = float(ele_elem.text) if ele_elem is not None else 0.0
        
        if i > 0:
            prev = route[-1]
            dist = haversine(prev['lat'], prev['lon'], lat, lon)
            total_dist += dist
            
        route.append({'distance': total_dist, 'ele': ele, 'lat': lat, 'lon': lon})
    return route

def detect_climbs(route):
    if len(route) < 2: return []

    smoothed_route = []
    half_window = CLIMB_SMOOTHING_WINDOW_SIZE // 2
    for i in range(len(route)):
        start_idx = max(0, i - half_window)
        end_idx = min(len(route) - 1, i + half_window)
        window = route[start_idx : end_idx + 1]
        avg_ele = sum(pt['ele'] for pt in window) / len(window)
        smoothed_route.append({'distance': route[i]['distance'], 'ele': avg_ele})

    climbs = []
    fatigue = 0
    max_fatigue_this_candidate = 0
    candidate_start = None
    candidate_peak = None
    is_active_climb = False
    
    # THE FIX: Syncing Accumulated Gain logic from JS
    running_accumulated_gain = 0
    peak_accumulated_gain = 0

    def close_candidate():
        nonlocal candidate_start, candidate_peak, is_active_climb, fatigue, max_fatigue_this_candidate
        nonlocal running_accumulated_gain, peak_accumulated_gain
        
        if candidate_start and candidate_peak:
            length_m = candidate_peak['distance'] - candidate_start['distance']
            net_gain_m = candidate_peak['ele'] - candidate_start['ele']
            avg_grade = (net_gain_m / length_m) * 100 if length_m > 0 else 0
            
            start_km = candidate_start['distance'] / 1000
            end_km = candidate_peak['distance'] / 1000
            
            print(f"      ↳ Segment Review: {start_km:.2f}km -> {end_km:.2f}km | Net Gain: {net_gain_m:.1f}m | Acc Gain: {peak_accumulated_gain:.1f}m | Grade: {avg_grade:.2f}%")
            
            if is_active_climb:
                # Use accumulated gain for the threshold check, net gain for the grade check
                if length_m > 0 and peak_accumulated_gain >= CLIMB_MIN_GAIN_METERS and avg_grade >= CLIMB_MIN_AVERAGE_GRADE_PERCENT:
                    climbs.append({
                        'start_km': start_km,
                        'end_km': end_km,
                        'gain': peak_accumulated_gain,
                        'grade': avg_grade
                    })
                    print("      ✅ STATUS: ACCEPTED AND LOGGED!")
                else:
                    reason = "Grade < 1.5%" if avg_grade < CLIMB_MIN_AVERAGE_GRADE_PERCENT else f"Acc Gain < {CLIMB_MIN_GAIN_METERS}m"
                    print(f"      ❌ STATUS: REJECTED BY SANITY CHECK ({reason})")
            else:
                print(f"      👻 STATUS: GHOST CLIMB (Drained before hitting {CLIMB_FATIGUE_THRESHOLD} threshold)")

        print("-" * 50)
        candidate_start = None
        candidate_peak = None
        is_active_climb = False
        fatigue = 0
        max_fatigue_this_candidate = 0
        running_accumulated_gain = 0
        peak_accumulated_gain = 0

    for i in range(1, len(smoothed_route)):
        pt = smoothed_route[i]
        prev = smoothed_route[i - 1]
        
        dist_change = pt['distance'] - prev['distance']
        if dist_change <= 0: continue
        
        ele_change = pt['ele'] - prev['ele']
        pt_km = pt['distance'] / 1000
        
        delta_fatigue = (ele_change * 100) - (CLIMB_RESTING_GRADIENT_PERCENT * dist_change)
        
        if delta_fatigue < 0:
            delta_fatigue *= CLIMB_RECOVERY_MULTIPLIER
            
        was_empty = (fatigue == 0)
        fatigue = min(CLIMB_MAX_FATIGUE, max(0, fatigue + delta_fatigue))
        
        if fatigue > max_fatigue_this_candidate:
            max_fatigue_this_candidate = fatigue

        if fatigue > 0:
            if was_empty:
                candidate_start = {'distance': prev['distance'], 'ele': prev['ele']}
                candidate_peak = {'distance': pt['distance'], 'ele': pt['ele']}
                running_accumulated_gain = max(0, ele_change)
                peak_accumulated_gain = running_accumulated_gain
                print(f"[{pt_km:.2f}km] 💧 BUCKET FILLING (Base Ele: {prev['ele']:.1f}m)")
            else:
                if ele_change > 0:
                    running_accumulated_gain += ele_change
                
            if candidate_peak and pt['ele'] > candidate_peak['ele']:
                candidate_peak = {'distance': pt['distance'], 'ele': pt['ele']}
                peak_accumulated_gain = running_accumulated_gain
                
            if fatigue >= CLIMB_FATIGUE_THRESHOLD and not is_active_climb:
                is_active_climb = True
                print(f"[{pt_km:.2f}km] ⛰️  THRESHOLD CROSSED! (Fatigue hit {fatigue:.0f})")
                
        elif not was_empty:
            print(f"[{pt_km:.2f}km] 🕳️  BUCKET DRAINED TO 0 (Max fatigue reached: {max_fatigue_this_candidate:.0f})")
            close_candidate()

    if fatigue > 0:
        print(f"[{smoothed_route[-1]['distance']/1000:.2f}km] 🏁 FINISH LINE HIT (Bucket still has {fatigue:.0f} fatigue)")
        close_candidate()

    return climbs

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python climb_tester.py <path_to_gpx_file>")
        sys.exit(1)
        
    file_path = sys.argv[1]
    
    try:
        route_data = parse_gpx(file_path)
    except FileNotFoundError:
        print(f"Error: The file '{file_path}' was not found.")
        sys.exit(1)
    except ET.ParseError:
        print(f"Error: The file '{file_path}' could not be parsed as XML.")
        sys.exit(1)
        
    print(f"\nParsed {len(route_data)} points. Total distance: {route_data[-1]['distance']/1000:.1f} km\n")
    print("=" * 50)
    print(" STARTING LEAKY BUCKET DIAGNOSTICS")
    print("=" * 50)
    
    valid_climbs = detect_climbs(route_data)
    
    print("\n" + "=" * 50)
    print(" FINAL ACCEPTED CLIMBS")
    print("=" * 50)
    if not valid_climbs:
        print("None!")
    for c in valid_climbs:
        print(f"▶ Climb: {c['start_km']:.2f}km to {c['end_km']:.2f}km | {c['gain']:.0f}m gain | {c['grade']:.1f}% avg")
    print("\n")