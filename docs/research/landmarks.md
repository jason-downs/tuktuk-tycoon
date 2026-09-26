# Chiang Mai passenger-generating places (landmarks data sheet)

Research date: 2026-09-26. Machine-readable twin: `landmarks.json` (88 records, same ids).

## Method and provenance

- **Coordinates**: every lat/lon is the OSM element's own position (`out center` for ways/relations) returned by a single Overpass id query against https://overpass-api.de/api/interpreter on 2026-09-26. Each row links its element (`https://www.openstreetmap.org/<osm_ref>`). Nothing is typed from memory. Data © OpenStreetMap contributors, ODbL.
- **District**: Nominatim reverse geocode at zoom 14 (https://nominatim.openstreetmap.org/reverse). Inside the city municipality it gives the ward (*khwaeng*): Nakhon Ping (NE Old City & north), Srivijaya (W Old City, Nimman, CMU), Mengrai (S Old City, Night Bazaar, Wua Lai), Kawila (east bank of the Ping: railway, Arcade, riverside). Outside, it gives the tambon or amphoe. Nominatim's `municipality` field for Thailand is unreliable (it tags the Old City as "Fa Ham"), so only the ward/town fields were used.
- **name_th**: the OSM `name`/`name:th`. Six Thai names come from a nearby OSM element, not the element itself: Somphet (from node/6426201141 "โจ๊กสมเพชร"), Chang Phueak bus station (from bus stop node/11710986390), CMU main gate (from guard booth way/236510768), Zoo (from way/105591056), Kad Suan Kaew (from police node/3347610537), Railway station (the OSM `name` is only "เชียงใหม่"). `null` means OSM has no Thai name. Thai names were not invented.
- **Pickup-point choice**: large sites use the entrance where OSM maps one. The Zoo uses node/3711065197 (`entrance=main`, unnamed), not the zoo polygon way/105591056 centroid (18.80379, 98.94373). CMU uses the main-entrance node, not the campus centroid. Night Safari uses node/1075186977 (`entrance=main`, inside the zoo polygon way/250585255, 0.79 km from its centroid). Royal Park Rajapruek uses node/1561123863 (`entrance=main`, inside the park polygon way/186782433).
- **Fact-check pass (2026-09-26)**: all 88 elements were re-fetched from Overpass; every stored coordinate is within 0.2 m of its element. Two records pointed at the wrong feature or a centroid far from the pickup point and were moved (Royal Park, Night Safari). Several hours, fees and dates were corrected against their cited sources. Kad Suan Kaew was found closed. The full list is under "Fact-check corrections" at the end.
- **demand_notes**: hours, fees and counts are cited below. Time-of-day windows without a citation are design estimates and count as **(unverified)**.

## Geometry anchors (Old City moat)

The four corner bastions frame the moat square. Great-circle distances computed from the OSM points below: E edge (Si Phum to Katam) **1.51 km**, N edge (Hua Lin to Si Phum) **1.42 km**, S edge **1.53 km**, W edge **1.52 km**. Tha Phae Gate sits on the E edge, Chang Phueak on the N, Suan Dok on the W, and Saen Pung and Chiang Mai Gate on the S edge.

Straight-line distances from Tha Phae Gate (node/1017379824), computed from the coordinates in this file. Road distance is longer.

| to | km | to | km |
|---|---|---|---|
| Loi Kroh bars | 0.70 | CNX terminal | 3.37 |
| Warorot | 0.81 | Central Festival | 3.42 |
| Night Bazaar | 0.82 | Bangkok Hospital | 3.50 |
| Saturday Walking St | 0.95 | Wat Umong | 4.31 |
| Chang Phueak bus stn | 1.54 | CMU main gate | 4.65 |
| JJ Market | 2.25 | Promenada | 5.16 |
| Railway station | 2.52 | Zoo entrance | 5.40 |
| Central Airport mall | 2.82 | Wat Doi Suthep | 7.73 |
| Arcade Terminal 2 | 2.91 | Royal Park Rajapruek (entrance) | 8.42 |
| One Nimman | 2.99 | Night Safari (entrance) | 8.83 |
| MAYA | 3.19 | Huay Tung Tao | 10.46 |
| | | Grand Canyon | 14.66 |

## All places (88)

Coordinates are WGS84, rounded here to 5 decimal places. `landmarks.json` keeps 6.

| id | name_en | name_th | lat, lon | category | ward / district | OSM |
|---|---|---|---|---|---|---|
| tha_phae_gate | Tha Phae Gate | ประตูท่าแพ | 18.78776, 98.99327 | gate | Khwaeng Nakhon Ping | [node/1017379824](https://www.openstreetmap.org/node/1017379824) |
| chang_phueak_gate | Chang Phueak Gate (North Gate) | ประตูช้างเผือก | 18.79543, 98.98659 | gate | Khwaeng Srivijaya | [node/11229077788](https://www.openstreetmap.org/node/11229077788) |
| suan_dok_gate | Suan Dok Gate (West Gate) | ประตูสวนดอก | 18.78884, 98.97819 | gate | Khwaeng Srivijaya | [node/6717438786](https://www.openstreetmap.org/node/6717438786) |
| saen_pung_gate | Saen Pung (Suan Prung) Gate | ประตูแสนปุง | 18.78155, 98.98160 | gate | Khwaeng Srivijaya | [node/11226724529](https://www.openstreetmap.org/node/11226724529) |
| chiang_mai_gate | Chiang Mai Gate (South Gate) | ประตูเชียงใหม่ | 18.78136, 98.98898 | gate | Khwaeng Mengrai | [node/6107975995](https://www.openstreetmap.org/node/6107975995) |
| si_phum_corner | Si Phum Corner (NE bastion) | แจ่งศรีภูมิ | 18.79500, 98.99342 | gate | Khwaeng Nakhon Ping | [way/263459882](https://www.openstreetmap.org/way/263459882) |
| hua_lin_corner | Hua Lin Corner (NW bastion) | แจ่งหัวลิน | 18.79537, 98.97995 | gate | Khwaeng Srivijaya | [way/317516852](https://www.openstreetmap.org/way/317516852) |
| ku_hueang_corner | Ku Hueang Corner (SW bastion) | แจ่งกู่เฮือง | 18.78184, 98.97812 | gate | Khwaeng Srivijaya | [way/317516851](https://www.openstreetmap.org/way/317516851) |
| katam_corner | Katam Corner (SE bastion) | แจ่งก๊ะต๊ำ | 18.78142, 98.99265 | gate | Khwaeng Mengrai | [way/791602197](https://www.openstreetmap.org/way/791602197) |
| wat_phra_singh | Wat Phra Singh | วัดพระสิงห์ | 18.78859, 98.98138 | temple | Khwaeng Srivijaya | [way/93414647](https://www.openstreetmap.org/way/93414647) |
| wat_chedi_luang | Wat Chedi Luang | วัดเจดีย์หลวงวรวิหาร | 18.78697, 98.98686 | temple | Khwaeng Srivijaya | [way/243018795](https://www.openstreetmap.org/way/243018795) |
| wat_chiang_man | Wat Chiang Man | วัดเชียงมั่น | 18.79379, 98.98939 | temple | Khwaeng Nakhon Ping | [way/98070869](https://www.openstreetmap.org/way/98070869) |
| wat_suan_dok | Wat Suan Dok | วัดสวนดอก | 18.78779, 98.96755 | temple | Khwaeng Srivijaya | [way/322604729](https://www.openstreetmap.org/way/322604729) |
| wat_umong | Wat Umong (Suan Buddha Dhamma) | วัดอุโมงค์(สวนพุทธรรม) | 18.78310, 98.95258 | temple | Tambon Suthep | [node/1445519684](https://www.openstreetmap.org/node/1445519684) |
| wat_sri_suphan | Wat Sri Suphan (Silver Temple) | วัดศรีสุพรรณ | 18.77865, 98.98335 | temple | Khwaeng Mengrai | [way/309886989](https://www.openstreetmap.org/way/309886989) |
| wat_lok_molee | Wat Lok Molee | วัดโลกโมฬี | 18.79641, 98.98257 | temple | Khwaeng Srivijaya | [way/692137164](https://www.openstreetmap.org/way/692137164) |
| wat_phan_tao | Wat Phan Tao | วัดพันเตา | 18.78769, 98.98745 | temple | Khwaeng Srivijaya | [way/243018378](https://www.openstreetmap.org/way/243018378) |
| wat_chet_yot | Wat Chet Yot | วัดเจ็ดยอด | 18.80897, 98.97215 | temple | Tambon Chang Phueak | [way/1561708867](https://www.openstreetmap.org/way/1561708867) |
| wat_doi_suthep | Wat Phra That Doi Suthep | วัดพระธาตุดอยสุเทพราชวรวิหาร | 18.80492, 98.92210 | temple | Tambon Suthep | [way/114651040](https://www.openstreetmap.org/way/114651040) |
| wat_pha_lat | Wat Pha Lat | วัดผาลาด | 18.79912, 98.93420 | temple | Tambon Suthep | [way/302732571](https://www.openstreetmap.org/way/302732571) |
| wat_buppharam | Wat Buppharam | วัดบุพพาราม | 18.78791, 98.99816 | temple | Khwaeng Mengrai | [way/261336735](https://www.openstreetmap.org/way/261336735) |
| wat_phan_on | Wat Phan On | วัดพันอ้น | 18.78759, 98.99117 | temple | Khwaeng Mengrai | [way/246253475](https://www.openstreetmap.org/way/246253475) |
| wat_doi_kham | Wat Phra That Doi Kham | วัดพระธาตุดอยคำ | 18.75944, 98.91884 | temple | Tambon Mae Hia | [way/313040943](https://www.openstreetmap.org/way/313040943) |
| three_kings | Three Kings Monument | อนุสาวรีย์สามกษัตริย์ | 18.79023, 98.98735 | attraction | Khwaeng Srivijaya | [node/1619287904](https://www.openstreetmap.org/node/1619287904) |
| arts_cultural_centre | Chiang Mai City Arts & Cultural Centre | หอศิลปวัฒนธรรมเมืองเชียงใหม่ | 18.79023, 98.98688 | museum | Khwaeng Srivijaya | [relation/17998804](https://www.openstreetmap.org/relation/17998804) |
| lanna_folklife | Lanna Folklife Museum | พิพิธภัณฑ์พื้นถิ่นล้านนา | 18.79023, 98.98841 | museum | Khwaeng Nakhon Ping | [way/261338789](https://www.openstreetmap.org/way/261338789) |
| national_museum | Chiang Mai National Museum | พิพิธภัณฑ์แห่งชาติ จังหวัดเชียงใหม่ | 18.81161, 98.97643 | museum | Tambon Chang Phueak | [way/200414775](https://www.openstreetmap.org/way/200414775) |
| baan_kang_wat | Baan Kang Wat Artist Village | บ้านข้างวัด | 18.77655, 98.94844 | attraction | Tambon Suthep | [way/1544408225](https://www.openstreetmap.org/way/1544408225) |
| old_cm_cultural_centre | Old Chiang Mai Cultural Center (khantoke) | ศูนย์วัฒนธรรมเชียงใหม่ | 18.77188, 98.98002 | attraction | Khwaeng Mengrai | [way/367745512](https://www.openstreetmap.org/way/367745512) |
| warorot_market | Warorot Market (Kad Luang) | ตลาดวโรรส | 18.79022, 99.00052 | market | Khwaeng Nakhon Ping | [way/89039067](https://www.openstreetmap.org/way/89039067) |
| ton_lamyai | Ton Lamyai Market & Flower Market | ตลาดต้นลำไย | 18.79043, 99.00140 | market | Khwaeng Nakhon Ping | [way/385577703](https://www.openstreetmap.org/way/385577703) |
| night_bazaar | Chiang Mai Night Bazaar | — | 18.78478, 99.00044 | market | Khwaeng Mengrai | [way/22981272](https://www.openstreetmap.org/way/22981272) |
| anusarn_market | Anusarn Market | ตลาดอนุสาร | 18.78257, 99.00151 | market | Khwaeng Mengrai | [way/494956275](https://www.openstreetmap.org/way/494956275) |
| kalare_night_bazaar | Kalare Night Bazaar | — | 18.78540, 99.00106 | market | Khwaeng Mengrai | [way/58560283](https://www.openstreetmap.org/way/58560283) |
| somphet_market | Somphet Market | ตลาดสมเพชร | 18.79150, 98.99308 | market | Khwaeng Nakhon Ping | [node/766631271](https://www.openstreetmap.org/node/766631271) |
| chiang_mai_gate_market | Chiang Mai Gate Market | ตลาดประตูเชียงใหม่ | 18.78179, 98.98839 | market | Khwaeng Srivijaya | [way/107940199](https://www.openstreetmap.org/way/107940199) |
| chang_phueak_market | Chang Phueak Night Market | ตลาดช้างเผือก | 18.79624, 98.98583 | market | Khwaeng Srivijaya | [way/103814235](https://www.openstreetmap.org/way/103814235) |
| muang_mai_market | Muang Mai Market | ตลาดเมืองใหม่ | 18.79718, 98.99821 | market | Khwaeng Nakhon Ping | [way/204243831](https://www.openstreetmap.org/way/204243831) |
| jing_jai_market | Jing Jai (JJ) Farmers Market | — | 18.80794, 98.99492 | market | Chiang Mai City Municipality | [way/232645469](https://www.openstreetmap.org/way/232645469) |
| kham_thiang_market | Kham Thiang Flower & Plant Market | ตลาดคำเที่ยง | 18.80646, 98.99846 | market | Chiang Mai City Municipality | [way/423030639](https://www.openstreetmap.org/way/423030639) |
| sunday_walking_street | Sunday Walking Street (Ratchadamnoen Rd) | ถนนคนเดินวันอาทิตย์ | 18.78821, 98.98799 | market | Khwaeng Nakhon Ping | [node/11538579352](https://www.openstreetmap.org/node/11538579352) |
| saturday_walking_street | Saturday Walking Street (Wua Lai Rd) | ถนนคนเดินวัวลาย | 18.78091, 98.98789 | market | Khwaeng Mengrai | [node/4252100590](https://www.openstreetmap.org/node/4252100590) |
| kad_na_mor | Kad Na Mor (CMU Front Gate Market) | กาดหน้ามอ | 18.80851, 98.95575 | market | Tambon Chang Phueak | [node/9915192025](https://www.openstreetmap.org/node/9915192025) |
| lang_mor_market | University Gate Food Market (Lang Mor) | — | 18.79327, 98.95388 | market | Khwaeng Srivijaya | [node/4430178975](https://www.openstreetmap.org/node/4430178975) |
| central_airport | Central Chiangmai Airport (Central Plaza Airport) | เซ็นทรัลพลาซ่า เชียงใหม่ แอร์พอร์ต | 18.76896, 98.97534 | mall | Tambon Suthep | [way/87710118](https://www.openstreetmap.org/way/87710118) |
| central_festival | Central Festival Chiangmai | เซ็นทรัล เฟสติวัล เชียงใหม่ | 18.80740, 99.01821 | mall | Tambon Fa Ham | [way/254011801](https://www.openstreetmap.org/way/254011801) |
| promenada | Promenada Resort Mall | — | 18.76635, 99.03674 | mall | Tambon Tha Sala | [way/315569180](https://www.openstreetmap.org/way/315569180) |
| maya | MAYA Lifestyle Shopping Center | เมญ่า | 18.80246, 98.96727 | mall | Tambon Chang Phueak | [way/249154472](https://www.openstreetmap.org/way/249154472) |
| one_nimman | One Nimman | — | 18.80006, 98.96800 | mall | Khwaeng Srivijaya | [way/627946317](https://www.openstreetmap.org/way/627946317) |
| think_park | Think Park | — | 18.80115, 98.96740 | mall | Khwaeng Srivijaya | [way/335541194](https://www.openstreetmap.org/way/335541194) |
| kad_suan_kaew | Kad Suan Kaew (Central Kad Suan Kaew), **closed since 30 Jun 2022** | กาดสวนแก้ว | 18.79618, 98.97730 | mall | Khwaeng Srivijaya | [node/7057867885](https://www.openstreetmap.org/node/7057867885) |
| cnx_airport | Chiang Mai International Airport (CNX) terminal | ท่าอากาศยานนานาชาติเชียงใหม่ | 18.76900, 98.96811 | transport | Tambon Suthep | [way/58309446](https://www.openstreetmap.org/way/58309446) |
| railway_station | Chiang Mai Railway Station | เชียงใหม่ | 18.78352, 99.01682 | transport | Khwaeng Kawila | [node/8797855637](https://www.openstreetmap.org/node/8797855637) |
| arcade_2 | Arcade Bus Terminal 2 | สถานีขนส่ง อาเขต (หมายเลข 2) | 18.80079, 99.01724 | transport | Khwaeng Kawila | [node/1572587486](https://www.openstreetmap.org/node/1572587486) |
| arcade_3 | Arcade Bus Terminal 3 | สถานีขนส่ง อาเขต (หมายเลข 3) | 18.79955, 99.01784 | transport | Khwaeng Kawila | [way/200738389](https://www.openstreetmap.org/way/200738389) |
| chang_phueak_bus | Chang Phueak Bus Station (Terminal 1) | สถานีขนส่งช้างเผือก | 18.80014, 98.98676 | transport | Chiang Mai City Municipality | [way/101345952](https://www.openstreetmap.org/way/101345952) |
| cmu_main_gate | Chiang Mai University Main Gate | ประตูหน้า มช. | 18.80819, 98.95474 | university | Khwaeng Srivijaya | [node/6465643507](https://www.openstreetmap.org/node/6465643507) |
| cmu_rajabhat | Chiang Mai Rajabhat University | มหาวิทยาลัยราชภัฏเชียงใหม่ | 18.80730, 98.98685 | university | Chiang Mai City Municipality | [way/329234389](https://www.openstreetmap.org/way/329234389) |
| maharaj_hospital | Maharaj Nakorn Chiang Mai Hospital (CMU Suan Dok) | โรงพยาบาลมหาราชนครเชียงใหม่ | 18.79184, 98.97428 | hospital | Khwaeng Srivijaya | [way/189618479](https://www.openstreetmap.org/way/189618479) |
| chiang_mai_ram | Chiang Mai Ram Hospital | โรงพยาบาลเชียงใหม่ราม | 18.79494, 98.97749 | hospital | Khwaeng Srivijaya | [way/257214959](https://www.openstreetmap.org/way/257214959) |
| bangkok_hospital | Bangkok Hospital Chiang Mai | โรงพยาบาลกรุงเทพ | 18.78873, 99.02654 | hospital | Tambon Nong Pa Khrang | [way/294031574](https://www.openstreetmap.org/way/294031574) |
| iron_bridge | Iron Bridge (Khua Lek) | ขัวเหล็ก | 18.78402, 99.00457 | viewpoint | Khwaeng Kawila | [way/1210218897](https://www.openstreetmap.org/way/1210218897) |
| nawarat_bridge | Nawarat Bridge | สะพานนวรัฐ | 18.78764, 99.00440 | viewpoint | Khwaeng Nakhon Ping | [way/39950433](https://www.openstreetmap.org/way/39950433) |
| the_riverside | The Riverside Bar & Restaurant | — | 18.78982, 99.00398 | nightlife | Khwaeng Kawila | [node/1057660774](https://www.openstreetmap.org/node/1057660774) |
| good_view | Good View | เดอะกู้ดวิว เชียงใหม่ | 18.79031, 99.00375 | nightlife | Khwaeng Kawila | [node/1618122055](https://www.openstreetmap.org/node/1618122055) |
| zoe_in_yellow | Zoe in Yellow / Ratchawithi bar lane | — | 18.79087, 98.99060 | nightlife | Khwaeng Nakhon Ping | [way/324214629](https://www.openstreetmap.org/way/324214629) |
| north_gate_jazz | North Gate Jazz Co-op | — | 18.79519, 98.98700 | nightlife | Khwaeng Nakhon Ping | [node/2110312355](https://www.openstreetmap.org/node/2110312355) |
| loi_kroh_bars | Loi Kroh Road bar strip | ถนนลอยเคราะห์ | 18.78409, 98.99871 | nightlife | Khwaeng Mengrai | [way/77991178](https://www.openstreetmap.org/way/77991178) |
| thapae_boxing | Thapae Boxing Stadium | — | 18.78721, 98.99250 | nightlife | Khwaeng Mengrai | [way/389507358](https://www.openstreetmap.org/way/389507358) |
| loi_kroh_boxing | Loi Kroh Boxing Stadium | — | 18.78337, 98.99771 | nightlife | Khwaeng Mengrai | [node/4470401889](https://www.openstreetmap.org/node/4470401889) |
| warm_up_cafe | Warm Up Cafe (Nimman) | — | 18.79516, 98.96484 | nightlife | Khwaeng Srivijaya | [relation/7093993](https://www.openstreetmap.org/relation/7093993) |
| chiang_mai_zoo | Chiang Mai Zoo (main entrance) | สวนสัตว์เชียงใหม่ | 18.81064, 98.94802 | attraction | Khwaeng Srivijaya | [node/3711065197](https://www.openstreetmap.org/node/3711065197) |
| huay_kaew_waterfall | Huay Kaew Waterfall | น้ำตกห้วยแก้ว | 18.81143, 98.94355 | park | Tambon Suthep | [node/1595547758](https://www.openstreetmap.org/node/1595547758) |
| khruba_monument | Khruba Srivichai Monument | อนุสาวรีย์ครูบาศรีวิชัย | 18.81283, 98.94613 | attraction | Tambon Suthep | [node/1595548120](https://www.openstreetmap.org/node/1595548120) |
| ang_kaew | Ang Kaew Reservoir (CMU) | อ่างแก้ว | 18.80728, 98.94938 | park | Khwaeng Srivijaya | [relation/14520615](https://www.openstreetmap.org/relation/14520615) |
| night_safari | Chiang Mai Night Safari (main entrance) | เชียงใหม่ไนท์ซาฟารี | 18.74396, 98.92327 | attraction | Tambon Mae Hia at the entrance (Nominatim) | [node/1075186977](https://www.openstreetmap.org/node/1075186977) |
| royal_park_rajapruek | Royal Park Rajapruek (main entrance) | อุทยานหลวงราชพฤกษ์ | 18.74817, 98.92505 | park | Tambon Mae Hia | [node/1561123863](https://www.openstreetmap.org/node/1561123863) |
| huay_tung_tao | Huay Tung Tao Lake | ทะเลสาบห้วยตึงเฒ่า | 18.86791, 98.94117 | park | Mae Rim District | [relation/9227296](https://www.openstreetmap.org/relation/9227296) |
| nong_buak_haad | Nong Buak Haad Public Park | สวนบวกหาด | 18.78229, 98.97927 | park | Khwaeng Srivijaya | [way/23973788](https://www.openstreetmap.org/way/23973788) |
| grand_canyon | Chiang Mai Grand Canyon (water park) | แกรนด์แคนยอน เชียงใหม่ | 18.69741, 98.89191 | attraction | Hang Dong District | [way/177772328](https://www.openstreetmap.org/way/177772328) |
| bhubing_palace | Bhubing Palace | พระตำหนักภูพิงคราชนิเวศน์ | 18.80506, 98.90102 | attraction | Tambon Suthep | [way/195700868](https://www.openstreetmap.org/way/195700868) |
| stadium_700 | 700th Anniversary Stadium | สนามกีฬาสมโภชเชียงใหม่ 700 ปี | 18.83980, 98.95933 | attraction | Mae Rim District | [relation/21102050](https://www.openstreetmap.org/relation/21102050) |
| moon_muang_soi_7 | Moon Muang Soi 6-9 backpacker area | ถนนมูลเมือง ซอย 7 | 18.79313, 98.99052 | hotel_area | Khwaeng Nakhon Ping | [way/19821092](https://www.openstreetmap.org/way/19821092) |
| nimman_soi_7_9 | Nimmanhaemin Soi 7-9 hotel & cafe area | ถนนนิมมานเหมินท์ ซอย 7 | 18.79813, 98.96886 | hotel_area | Khwaeng Srivijaya | [way/90564604](https://www.openstreetmap.org/way/90564604) |
| pillars_137 | 137 Pillars House | — | 18.79189, 99.00405 | hotel_area | Khwaeng Kawila | [way/528019091](https://www.openstreetmap.org/way/528019091) |
| anantara | Anantara Chiang Mai Resort | — | 18.78195, 99.00390 | hotel_area | Khwaeng Mengrai | [node/1030346574](https://www.openstreetmap.org/node/1030346574) |
| shangri_la | Shangri-La Chiang Mai | — | 18.77837, 99.00074 | hotel_area | Khwaeng Mengrai | [way/440038015](https://www.openstreetmap.org/way/440038015) |
| tamarind_village | Tamarind Village | — | 18.78859, 98.98972 | hotel_area | Khwaeng Nakhon Ping | [node/3410834689](https://www.openstreetmap.org/node/3410834689) |

## Cited facts for demand modelling (hours, fees and volumes, with year)

**Transport hubs**
- CNX airport: 9,517,206 passengers in 2025 (6,951,520 domestic, 2,565,686 international), 9,082,071 in 2024, 11,333,548 in 2019 (pre-COVID peak) ([Wikipedia/AOT stats](https://en.wikipedia.org/wiki/Chiang_Mai_International_Airport)). AOT pledged a 24 bn THB investment, and passengers are "expected to rise to 20 million people by 2027" (Aug 2024 article, [CityLife](https://www.chiangmaicitylife.com/citynews/general/aot-to-invest-24billion-baht-in-chiang-mai-airport-upgrade-in-anticipation-of-20-million-tourists-a-year-by-2027/)). Game use: about 26,000 passengers/day in 2025 (9.52 M / 365).
- Arcade Bus Terminals: the main long-distance hub for all of northern Thailand, about 3 km NE of the moat, with three terminal buildings and overnight VIP buses to Bangkok ([Travelfish](https://www.travelfish.org/transport_detail/thailand/northern_thailand/chiang_mai/chiang_mai/3)). Bangkok to Arcade buses run about hourly ([Rome2rio](https://www.rome2rio.com/Bus/Bangkok/Chiang-Mai-Arcade-Bus-Terminal)).
- Chang Phueak (Terminal 1): provincial buses to Mae Rim, Chiang Dao, Fang, Tha Ton, Phrao, Hot, Chom Thong, Doi Tao and Samoeng ([ChiangMaiTravelHub](https://www.chiangmaitravelhub.com/information/chang-puak-bus-station/)). OSM also maps yellow songthaew stands next door, to San Kamphaeng, Hang Dong, Mae Rim and Chom Thong (nodes 12543091916, 12543092005, 12543092113, 12543092303).
- Songthaew hub at Warorot/Ton Lamyai (competition for tuk-tuks): OSM stops for Bo Sang (node/12543092111), Doi Saket/Mae Rim/Mae Taeng (node/12543092205), Samoeng (node/12543092206), and "Nimman, Maya, CMU, Zoo" (node/12543092401).

**Markets and walking streets**
- Sunday Walking Street (Ratchadamnoen Rd) and Saturday Walking Street (Wua Lai Rd) both run 17:00-23:00. Best browsing from 17:00, crowds peak 19:00-21:00. Entry free ([ChiangMaiAmbassador 2026](https://chiangmaiambassador.com/guides/walking-street-markets)).
- Night Bazaar (Chang Klan Rd): daily from about 17:00/18:00 to midnight, busiest 19:00-22:00 ([Thaiger](https://thethaiger.com/travel/chiang-mai-travel/chiang-mai-night-bazaar-travel-guide), [chiangmai-trip](https://www.chiangmai-trip.com/destinations/night-bazaar/)).
- Warorot: 06:00-19:00 daily ([ChiangMaiTravelHub](https://www.chiangmaitravelhub.com/attractions/warorot-market/), answered 403 on re-check). The OSM tag on way/89039067 says 07:00-18:00 (conflict). Ton Lamyai flower market is nominally 24/7, with many stalls closing off-peak. Best early morning, when flower deliveries arrive ([catisoutoftheoffice](https://catisoutoftheoffice.com/ton-lamyai-market/)).
- Chiang Mai Gate Market: 04:00-12:00 fresh market and 17:00-24:00 night food market, daily, with stalls on both sides of Bumrung Buri Rd ([twoticketsanywhere](https://www.twoticketsanywhere.com/chiang-mai-gate-market/), updated Jun 2026). The OSM tag says Th-Mo 07:00-22:00 (conflict). OSM maps the market building (way/107940199) just inside the moat on Bumrung Buri Rd, and the night food stalls separately (node/4430138378, 18.78126, 98.98831).
- Somphet: 05:00-19:00 per [ChiangMaiTravelHub](https://www.chiangmaitravelhub.com/attractions/somphet-market/), but the OSM tag on node/766631271 says 06:00-16:00 (conflict, unresolved).
- Muang Mai (wholesale): the largest fruit and vegetable market, open daily 06:00-19:00. Google lists it as 24 h, but most vendors close at night. Arrive early for the freshest produce ([catisoutoftheoffice](https://catisoutoftheoffice.com/mueang-mai-market/), updated Nov 2024). A pre-dawn wholesale window and any intraday price rise are **(unverified)**.
- Jing Jai (JJ) weekend market: Sat-Sun 06:30-15:00 per [jontotheworld](https://jontotheworld.com/jing-jai-market-chiang-mai-complete-guide/), which recommends 07:30-10:30. Other listings give a 14:00 close.
- Kad Na Mor (CMU front gate): daily 17:00-22:00. Stalls set up from 17:00, and the market is busiest after 18:30 when classes end ([chiangmaimaster](https://www.chiangmaimaster.com/place/kad-na-mor-cmu-night-market)). Later closing times cited from [BrandThink](https://www.brandthink.me/content/malin-plaza/) are **(unverified)**.
- Kalare Night Bazaar: travel sites still list it, but the Kalare boxing stadium's Facebook page showed "closed" with an Oct 2025 post ([FB](https://www.facebook.com/p/Kalare-Night-Bazaar-Boxing-Stadium-100054650610191/)). Operating status **(unverified)**.

**Nightlife and Muay Thai**
- Thapae Boxing Stadium: Mon-Sat, doors 20:00, fights 21:00 ([chiangmaiboxingstadiums](https://www.chiangmaiboxingstadiums.com/post/what-time-do-the-fights-start-at-thaphae-boxing-stadium)). About 7 bouts and a 23:30 finish: **(unverified)**, since that page gives neither.
- Loi Kroh Boxing Stadium: fights Mon/Wed/Fri 21:00-24:00, closed the other nights with occasional Tue/Thu events. Tickets are 600 THB standard and 1,000 THB VIP ringside ([muaythaichiangmai](https://muaythaichiangmai.com/loi-kroh-boxing-stadium)). Doors open about 20:00 ([chiangmaiboxingstadiums](https://www.chiangmaiboxingstadiums.com/post/what-time-do-the-fights-start-at-loi-kroh-boxing-stadium)). A third stadium, Anusarn Boxing Stadium (node/6387004743, 18.78217, 99.00121), is in OSM but not in the JSON.
- Zoe in Yellow and the Ratchawithi/Ratchaphakhinai bar lane: backpacker hub that closes around midnight to 01:00 ([TripAdvisor FAQ](https://www.tripadvisor.com/FAQ_Answers-g293917-d3915397-t7612660-Does_it_really_close_at_midnight.html)). That makes a sharp return-to-guesthouse spike. Roots Rock Reggae (node/1491288233, 18.79122, 98.99076) is in the same lane.
- OSM `opening_hours`: The Riverside is Mon-Sun 17:00-01:00 (node/1057660774). North Gate Jazz Co-op is Mo-Su 20:00-02:00 (node/2110312355).

**Attractions and parks**
- Wat Phra That Doi Suthep: 06:00-20:00 (OSM tag on way/114651040). 309 steps up from the car park, or a tram, and 15 km from the city ([Wikipedia](https://en.wikipedia.org/wiki/Wat_Phra_That_Doi_Suthep)). A 30 THB foreigner temple fee is **(unverified)**. The Doi Suthep-Pui National Park fee from 1 Oct 2025 covers Huai Kaew waterfall, Pha Lat trail, Doi Pui and others: foreign adult 100 THB, Thai adult 20 THB. The temple and Wat Pha Lat by the main road are exempt ([CityLife](https://www.chiangmaicitylife.com/citynews/general/entrance-fees-required-at-doi-suthep-pui-starting-october-2025/)).
- Visakha Bucha (May): an overnight walk from the Khruba Srivichai Monument up to Doi Suthep. It usually starts at 20:00, covers about 9 km and takes 3-4 hours ([thailandee](https://www.thailandee.com/en/events-thailand/visakha-bucha-day-walking-ceremony-to-doi-suthep-147)). The figures of ~10,000 walkers and 11 km come from the [TAT](https://www.tourismthailand.org/Events-and-Festivals/traditional-walk-up-doi-suthep-for-visakha-bucha) page, which answered 403 on re-check: **(unverified)**.
- Chiang Mai Zoo: hours conflict. [ChiangMaiTravelHub](https://www.chiangmaitravelhub.com/attractions/chiang-mai-zoo/) gives 08:00-17:00 (it answered 403 on re-check), and [Wikivoyage](https://en.wikivoyage.org/wiki/Chiang_Mai) gives 09:00-17:00, adult 350 THB, child 120 THB. The official chiangmaizoo.com failed its TLS certificate check, so both are **(unverified)**.
- Night Safari: ticket booth 11:00-21:00, park closes 22:00. Safari Tram costs foreign adult 1,200 THB / child 600 and Thai adult 300 / child 150. Jaguar Trail (walking) costs foreign adult 400 / Thai adult 50. The site advises arriving about 17:00 to see every show ([official site](https://chiangmainightsafari.com/), 2026). The Holidify page cited earlier says 11:00-23:00, which conflicts with the official site.
- Royal Park Rajapruek: daily 08:00-18:00. Foreign adult 200 THB / child 150, Thai adult 100 / child 70, under 100 cm free ([royalparkrajapruek.org/Admission](https://www.royalparkrajapruek.org/Admission), read 2026-09-26). In OSM the park polygon is way/186782433 "Royal Flora Ratchaphruek Park" (`leisure=park`, centre 18.75110, 98.92316). way/389552865 is only the "Orchid Garden" sub-area.
- Huay Tung Tao: entry 50 THB, with no Thai/foreign split shown. Hours are 08:00-20:00 per [Holidify](https://www.holidify.com/places/chiang-mai/huay-tung-tao-lake-sightseeing-123235.html) but 08:00-18:00 per the OSM tag on relation/9227296 (conflict). A 20 THB Thai rate is **(unverified)**. The stored point is the lake centroid, which lies in the water, so snap it to the lakeside road. It lies at 18.868 N, just north of the requested 18.86 bound.
- Chiang Mai Grand Canyon: at 18.697 N (Hang Dong), just south of the 18.70 bound. It is a water park now (OSM `leisure=water_park`).

**Institutions**
- Chiang Mai University: 38,269 students (2023, latest found) ([Wikipedia](https://en.wikipedia.org/wiki/Chiang_Mai_University)). 2024-26 figure (unverified).
- Maharaj Nakorn Chiang Mai (Suan Dok) Hospital: 1,400 beds ([Wikipedia](https://en.wikipedia.org/wiki/Maharaj_Nakorn_Chiang_Mai_Hospital)). Outpatient volume (unverified).
- Old City municipal museums (City Arts & Cultural Centre, Lanna Folklife Museum, Historical Centre): Wed-Sun 08:30-16:30 including public holidays, closed Mon and Tue ([cmocity.com](https://www.cmocity.com/), 2026). Chiang Mai National Museum: We-Su 09:00-16:00 per its OSM tag **(unverified)**.
- Wat Chiang Man: the first temple of Chiang Mai, built by King Mangrai in 1297 ([Wikipedia](https://en.wikipedia.org/wiki/Wat_Chiang_Man)). OSM tag hours are 05:00-18:00.

**Malls**
- Kad Suan Kaew: **closed**. Public operation ended 30 Jun 2022, and the property was advertised for sale at 3 bn THB in Sep 2024 ([Wikipedia](https://en.wikipedia.org/wiki/Kad_Suan_Kaew)). OSM now names the building relation/6091082 "12 Huay Kaew Complex". Its current use is **(unverified)**.
- Central Chiangmai Airport: renamed from CentralPlaza Chiang Mai Airport in early 2022, opened March 1996 ([Wikipedia](https://en.wikipedia.org/wiki/Central_Chiangmai_Airport)). OSM tag hours: Mo-Fr 11:00-21:00, Sa-Su 10:00-21:00. It is 0.76 km in a straight line from the CNX terminal building.
- Central Festival: opened 15 Nov 2013, 250,000 m² ([Central Pattana](https://www.centralpattana.co.th/en/our-business/shopping-center/357/central-chiangmai)). The CPN URL slug "central-chiangmai" suggests a current brand of "Central Chiangmai" **(unverified)**.

**Festival calendar (demand spikes)**
- Flower Festival: 13-15 Feb 2026 at Nong Buak Haad Park. Parade on Sat 14 Feb from 08:00, Nawarat Bridge to Tha Phae Rd to the moat road to Nong Buak Haad ([pm-tours](https://www.pm-tours.com/pm-tours-blog/chiang-mai-flower-festival-2026)). One other listing gives a 07:30 start. The [thailand.go.th](https://thailand.go.th/event-detail/chiang-mai-flower-festival-2026) page returned no content on re-check.
- Songkran: 13-15 Apr (events 12-15 Apr). The Phra Buddha Sihing image is paraded and bathed, based at Wat Phra Singh ([TAT](https://www.tourismthailand.org/Attraction/wat-phra-sing), [InterContinental CM](https://chiangmai.intercontinental.com/en/blog/songkran-chiang-mai-2026-travel-guide)).
- Inthakin (city pillar) festival at Wat Chedi Luang: follows the lunar calendar, "usually in late May or early June", and lasts about a week (2022: 27 May-2 Jun) ([thaizer](https://www.thaizer.com/chiang-mai-city-pillar-inthakin-festival-wat-chedi-luang/)). The 2026 dates (23-29 May, from [expatsthai](https://expatsthai.com/events/inthakin-festival-chiang-mai-2026), which answered 403 on re-check) are **(unverified)**.
- Visakha Bucha Doi Suthep walk: May (see above).
- Loy Krathong: 24 Nov 2026, a Tuesday ([Wikipedia date table](https://en.wikipedia.org/wiki/Loy_Krathong)). Yi Peng in Chiang Mai runs **23-25 Nov 2026**, peaking on the full moon of Tue 24 Nov. Lantern releases at Tha Phae Gate plaza run 18:30-22:30 nightly, and the plaza "routinely tops 30,000 people" on the peak night. Krathong are floated on the Ping between Nawarat Bridge and Iron Bridge. Wat Phan Tao holds candle-lit chanting from 19:00, and Three Kings Monument plaza hosts the cultural fair and Krathong Yai parade staging ([beautiful-chiangmai](https://www.beautiful-chiangmai.com/festivals/yi-peng-loy-krathong/)). Ticketed mass releases are held outside the map at Doi Saket and Mae Jo (search-result summary, **unverified**).
- Nov-Feb cool-season tourist peak: **(unverified)**, not researched here.

## Caveats / unverified

- OSM tagging quirks, with coordinates still correct: the Anantara node's `name` has a stray "下午茶" suffix. Kad Suan Kaew is taken from the "Central Kad Suan Keaw" department-store node (the surrounding complex relation/6091082 is named "12 Huay Kaew Complex"). The Wat Umong node is "วัดอุโมงค์(สวนพุทธรรม)". Central Plaza Airport is still named "เซ็นทรัลพลาซ่า เชียงใหม่ แอร์พอร์ต" in OSM, while the mall's current brand is "Central Chiangmai Airport" (renamed early 2022, [Wikipedia](https://en.wikipedia.org/wiki/Central_Chiangmai_Airport)). The Night Safari's OSM `name` has a typo ("เชีงใหม่"). The JSON uses the spelling on the official site, "เชียงใหม่ไนท์ซาฟารี".
- CNX: tuk-tuks drop off at departures, while arrivals use the official taxi/app queue **(unverified)**.
- Old Chiang Mai Cultural Center: its khantoke show times are **(unverified)**. The OSM way/367745512 is "ศูนย์วัฒนธรรมเชียงใหม่" on Wua Lai Rd.
- Mall opening hours come only from OSM tags **(unverified)**. The municipal museums' days were verified (Wed-Sun). The National Museum's days come from OSM only **(unverified)**.
- Kalare Night Bazaar: still mapped in OSM (way/58560283, `landuse=retail`), but its operating status in 2026 is **(unverified)**.

## Fact-check corrections (independent pass, 2026-09-26)

Method: all 88 `osm_ref` elements were re-fetched from Overpass (`out center`) and each stored lat/lon matched its element to within 0.2 m. Each element's tags were checked to confirm it is the named place. Hours, fees and dates were re-read at the cited URLs.

| claim | corrected to | source |
|---|---|---|
| Royal Park at way/389552865 (18.74987, 98.92476) | That way is the "Orchid Garden" sub-area (`landuse=greenhouse_horticulture`), 216 m from the park centroid. Now the main entrance node/1561123863 (18.748168, 98.92505) inside the park polygon way/186782433 | Overpass |
| Night Safari at the polygon centroid (18.73835, 98.91875) | The centroid is 0.79 km inside the zoo. Now the `entrance=main` node/1075186977 (18.743958, 98.92327), inside way/250585255 | Overpass |
| Night Safari "11:00-22:00, last entry 21:00" cited to Holidify | Holidify says 11:00-23:00. The official site gives booth 11:00-21:00, close 22:00, and fees were added | chiangmainightsafari.com |
| Royal Park foreign adult "200-250 THB (2025)" | 200 THB (Thai 100) | royalparkrajapruek.org/Admission |
| Huay Tung Tao "09:00-18:00, 50 THB foreigners / 20 THB Thais" | The cited Holidify page gives 08:00-20:00 and a flat 50 THB. OSM gives 08:00-18:00. The 20 THB Thai rate is unverified | Holidify, OSM |
| Muang Mai "trading 04:00-07:00, then prices rise 15-25%" | Not in the cited source. It gives 06:00-19:00 daily, arrive early. The price-rise figure was removed | catisoutoftheoffice |
| Ton Lamyai "flower trucks arriving in the evening" | Deliveries arrive in the early morning | catisoutoftheoffice |
| JJ Market "best 07:00-09:00" | 07:30-10:30, open 06:30-15:00 | jontotheworld |
| Kad Na Mor "17:00/18:00-22:30/23:00, swamped from 18:00" | 17:00-22:00, busiest after 18:30 | chiangmaimaster |
| Loi Kroh Boxing "to ~23:30, + Saturday" | Mon/Wed/Fri 21:00-24:00, closed Saturday, 600/1,000 THB | muaythaichiangmai.com |
| Thapae Boxing "about 7 bouts" | Not in the cited page, now unverified | chiangmaiboxingstadiums.com |
| Walking streets "thick crowds after 19:00" | Crowds peak 19:00-21:00 | chiangmaiambassador |
| Flower Festival parade "from about 09:00" | 08:00 (one listing says 07:30) | pm-tours |
| Visakha Bucha walk "~10,000 people, 11 km, 18:30-20:00" | thailandee gives 20:00, ~9 km, 3-4 h. The TAT figures could not be re-read (403) and are unverified | thailandee |
| Museums "Tue-Sun (unverified)" | Wed-Sun 08:30-16:30, closed Mon-Tue | cmocity.com |
| Wat Chiang Man "oldest temple (unverified)" | The first temple of Chiang Mai, 1297, King Mangrai | Wikipedia |
| Central Airport "1.5 km from CNX terminal" | 0.76 km straight line | computed from OSM points |
| Kad Suan Kaew treated as a live mall | Closed since 30 Jun 2022 | Wikipedia |
| Moat "N-S edge (Si Phum to Katam)" | E edge, still 1.51 km | computed |
| AOT "expansion for 20 M passengers/yr by 2027" | The article says passengers are *expected to rise* to 20 M by 2027. It does not give a capacity figure | CityLife, Aug 2024 |
| Loy Krathong / Yi Peng "(unverified), not researched" | Filled in: 23-25 Nov 2026, peak Tue 24 Nov | Wikipedia, beautiful-chiangmai |

Confirmed as written: all five gates, the four bastions, all ten required temples and the other 70+ coordinates (within 0.2 m of their OSM elements, and each element is the named place). Also confirmed: CNX 9,517,206 passengers in 2025, 9,082,071 in 2024 and 11,333,548 in 2019. CMU has 38,269 students (2023) and Maharaj has 1,400 beds. The Doi Suthep-Pui park fee from 1 Oct 2025 is 100/20 THB, with the temple and Wat Pha Lat exempt. Thapae Boxing runs Mon-Sat with doors at 20:00 and fights at 21:00. The Chiang Mai Gate Market hours are confirmed. Every figure in the Tha Phae Gate distance table matches a recomputation.

Could not verify: the 30 THB Doi Suthep temple fee, zoo hours (the official site's TLS certificate failed), 2026 Inthakin dates, Kalare's operating status, Central Festival's current brand, the National Museum's days, and all time-of-day windows marked as design estimates.
- The four ward names come from Nominatim, not the municipality's own maps. Four northern points (Jing Jai, Kham Thiang, Chang Phueak bus station, Rajabhat) got no ward and are marked "Chiang Mai City Municipality".
