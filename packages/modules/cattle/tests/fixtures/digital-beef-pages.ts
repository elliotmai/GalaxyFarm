/**
 * Real Digital Beef pages, as a person copied them out of a browser.
 *
 * Checked in rather than mocked because the three association templates differ
 * in ways nobody would invent: Chianina prints `reg name [tattoo]`, the other
 * two print `reg [tattoo] name`, Shorthorn adds a second line with colour and
 * date of birth and drops the `--` before its defect flags, and each spells the
 * tattoo field differently. Every rule in the parser was written against these.
 *
 * Trimmed of navigation and the login form, which is all that was removed.
 */

export const CHIANINA_PAGE = ` Animal Detail Screen \t   \t  
Identification\t\tOther Details
 Sex:  \tBull\t Sire:  MA364424 \t CMAC TYSON ET 
 Name:  \tZNT MONTEGO BAY 901W\t Dam:  337003 \t ZNT JENNA 707T 
 Herd Prefix/Tattoo:  \t
ZNT\tLE: 901W 
 Chianina %:  \t3.72  Classification: 1CM
 Registration:  \t359968\t Genetic Makeup:  \t3.72% CA | 79.57% MA | 14.41% AN | 2.3% XX 
 International ID:  \tCIAUSAM000000359968\t  COI:  \t4.57%
 EID:  \t\t Service Type:  \tArtificial Insemination
 Horn/Poll/Scur: \tPolled\t Breeder:  \t(N) NATALIE MAI (65020) 
 Color: \tBlack\t Owner:  \t(N) NATALIE MAI (65020) 
 \t DOB: 06/19/2009  \t Age: 17 years, 1 month, 23 days
 Status:  \tActive
  \t  \t  View Data Sheet  
 
tab left\tPedigree\ttab right
tab left\tOwnership\ttab right
tab left\tEPDs\ttab right
tab left\tProgeny\ttab right
   5-Generation Pedigree   
Defect Key:  \t     Free by Test\t     Free by Pedigree\t     Suspected Carrier\t     Carrier by Test\t     Affected by Test
  \t
connector\tMA185219        JF WAR CHIEF         [ 38C JMAF ]   
connector\tMA242107        NBH POLLED ENERGIZER 688         [ NBH688E NBH688E ]   
connector\tMA22307        DUKES MARVELLA 88X         [ ]   
connector\tMA307184        COWAN'S ALI 4M         [ COWN4M ]    -- PHAF THF
connector\tMA208505        FJH LEGACY 130E         [ FJH130E ]   
connector\tMA247352        FJH COUNTESS 115H         [ 115H ]   
connector\tMA245657        ZTA MISS BLACK LUCY 110D         [ ]   
Sire:  \t
MA364424        CMAC TYSON ET         [ ]    -- AMS DDS NHS PHAFT THFT
  \t
connector\tMA120327        PISTOL PETE         [ JJW446V ]   
connector\t264745        FGJ HABANERO         [ FGJ9500E ]    -- AMS DDS NHS PHAFT THFT
connector\t264685        JDA MS PWR PLANT 19A 1CM         [ 19A ]    -- AMS DDS NHS
connector\tMA276888        CMAC KATARINA ET         [ ]    -- AMS DDS NHS
connector\tMA135189        FR MAGIC 179X         [ GFF179X ]   
connector\tMA196960        D&D SWEET DANDY         [ ]   
connector\tMA142764        MAJORS RB SWEET CHEEKS         [ ]   
  \t
connector\tMA227544        RSG PAY OFF 805E MCF         [ RSG805E ]    -- PHAF THF
connector\tMA291476        MCF MR DEBS GIRL PAYOFF         [ MCF23L ]    -- PHAF THF
connector\tMA195844        DEBBIES GIRL RW71C         [ ]   
connector\tMA323178        CMAC HARD CORE         [ CMAC55N ]    -- AMS DDS NHS PHAFT THFT
connector\t264745        FGJ HABANERO         [ FGJ9500E ]    -- AMS DDS NHS PHAFT THFT
connector\tMA267938        CMAC DANDYS SAMANTHA ET         [ ]    -- AMS DDS NHS
connector\tMA196960        D&D SWEET DANDY         [ ]   
Dam:  \t
337003        ZNT JENNA 707T         [ 707T ]    -- AMS DDS NHS PHAFP THFP
  \t
connector\t240047        WYR IMPULSE 1CA         [ 0315E ]   
connector\t276412        CTR SUCCESS 02K 2CA         [ 02K ]   
connector\t276404        CTR STARLIGHT 5691E 1CA         [ 5691E ]   
connector\t303231        JAZX AUDREY 352N         [ 352N ]    -- PHAFT THFT
 
connector\tC102102        JAZX MAINE ANJOU 352         [ ]   
 
\t
\tDigitalBeef, LLC | PostNuke | Zikula \t
`;

export const MAINE_ANJOU_PAGE = ` Animal Detail Screen \t   \t  
HIGH MAINE
Identification\t\tOther Details
 Sex:  \tBull\t Sire:  364424 \t CMAC TYSON ET 
 Name:  \tZNT MONTEGO BAY 901W\t Dam:  378987 \t ZNT JENNA 707T 
 Right Ear:   \t Left Ear:  ZNT901W \t Classification:  \tPB      Registered AN:  3.12%
 Registration:  \t402303\t   \t 
 International ID:  \tRDPUSAM000000402303\t  COI:  \t5.14%
 EID:  \t\t Service Type:  \tArtificial Insemination
 Horn/Poll/Scur: \tPolled\t Breeder:  \t(J) NATALIE MAI (631651) 
 Color: \tBlack\t Owner:  \t(J) NATALIE MAI (631651) 
 \t DOB: 06/19/2009  \t Disposal: 03/17/2022
 Status:  \tCulled - Culled - age
tab left\tPedigree
 \ttab right
tab left\tDNA
 \ttab right
   5-Generation Pedigree   
Defect Key:  \t     Free by Test\t     Free by Pedigree\t     Possible Carrier\t     Carrier by Test\t     Affected by Test
  \t
connector\t185219        [ 38C JMAF ]        JF WAR CHIEF   -- PHAFP THFP
connector\t242107        [ NBH688E NBH688E ]        NBH POLLED ENERGIZER 688E   -- PHAF THF
connector\t22307        [ MNK88X ]        DUKES MARVELLA 88X  
connector\t307184        [ COWN4M ]        COWAN'S ALI 4M   -- PHAF THF
connector\t208505        [ FJH130E ]        FJH LEGACY 130E   -- PHAF THF
connector\t247352        [ FJH115H ]        FJH COUNTESS 115H  
connector\t245657        [ ZTA110D ]        ZTA MISS BLACK LUCY 110D  
Sire:  \t
364424        [ CMAC301R ]        CMAC TYSON ET   -- PHAF THF
  \t
connector\t120327        [ JJW446V ]        PISTOL PETE   -- PHAF THF
connector\t222571        [ 19AE ]        FGJ HABANERO 1CM   -- PHAF THF
connector\t161082        [ JDA19A ]        JDA MISS POWER PLANT 19A  
connector\t276888        [ CMAC 28K ]        CMAC KATARINA ET   -- PHAF THF
connector\t135189        [ GFF179X ]        FR MAGIC 179X   -- PHAF THF
connector\t196960        [ CDCC9D ]        C&D SWEET DANDY  
connector\t142764        [ MAJR 933Y ]        MAJORS RB SWEET CHEEKS  
  \t
connector\t227544        [ RSG805E ]        RSG PAY OFF 805E MCF   -- PHAF THF
connector\t291476        [ MCF23L ]        MCF MR DEBS GIRL PAYOFF   -- PHAF THF
connector\t195844        [ RW71C ]        DEBBIES GIRL RW71C   -- PHAF THF
connector\t323178        [ CMAC55N ]        CMAC HARD CORE   -- PHAF THF
connector\t222571        [ 19AE ]        FGJ HABANERO 1CM   -- PHAF THF
connector\t267938        [ CMAC105J ]        CMAC DANDY'S SAMANTHA ET   -- PHAF THF
connector\t196960        [ CDCC9D ]        C&D SWEET DANDY  
Dam:  \t
378987        [ ZNT707T ]        ZNT JENNA 707T   -- PHAF THF
  \t
connector\tCA240047        [ ]        WYR IMPULSE 1CA  
connector\tCA276412        [ ]        CTR SUCCESS 02K  
connector\tCA276404        [ ]        CTR STARLIGHT 5691E  
connector\t330284        [ JAZX352N ]        JAZX AUDREY 352N   -- PHAF THF
connector\t165764        [ RSD202A ]        DESIGNED BY SHOWTIME  
connector\t330283        [ JAZX720G ]        JAZX MS 720G  
connector\t203347        [ JAZX012D ]        JAZX MS DESIGN 012D  
\t
\tDigitalBeef, LLC | PostNuke | Zikula \t
`;

export const SHORTHORN_PAGE = ` Animal Detail Screen \t   \t  
Identification\t\tOther Details
 Sex:  \tCow\t Sire:  *x4058319 \t JAKE'S PROUD JAZZ 266L 
 Name:  \tDREAM COME TRUE\t Dam:  *x4157771 \t SULL TINA'S SOLUTION ET 
 Herd Prefix: \t Tattoo - LE: 204C : \t
 Shorthorn %:  \tSH100
 Registration:  \t*s4219133\t   \t 
 International ID:  \tBSHUSAF000004219133\t  COI:  \t2.71%
 EID:  \t\t Service Type:  \tArtificial Insemination
 Horn/Poll/Scur: \tScurred\t Breeder:  \t(N) ZANE HAY (44-07963) 
 \t DOB: 03/02/2015  \t Age: 11 years, 5 months, 10 days
 Status:  \tActive - Active
 Color: Roan
tab left\tEPDs\ttab right
tab left\tPedigree\ttab right
tab left\tDNA\ttab right
   5-Generation Pedigree   
  \t
connector\tx2887446        [ T559 ]        CORONET MAX LEADER  
 \tRoan, 09/22/1955
connector\tx3098353        [ T053 ]        TPS CORONET LEADER 21ST  
 \tWhite, 10/15/1960, LEWIS W. THIEMAN
connector\t2906288        [ ]        NONPAREIL LADY 163D  
 \tRed
connector\t*s4034704        [ 243H ]        JAKES PROUD LEADER 243H   DSP PHAF THF
 \tRoan, 08/25/1998, JACOB T OHLDE
connector\t*xAR30384        [ 245B ]        OCC JAKE'S PRIDE 245B   DSC PHAF THF
 \tRoan, 11/06/1992, JACOB T OHLDE
connector\t*AR30478        [ 6113 ]        POLY ROSE 6113   DSP
 \tRoan, 10/01/1996, CAL POLY
connector\t3908179        [ 2112 ]        POLY C MAID 2112  
 \tRed, 09/23/1992, CAL POLY
Sire:  \t
*x4058319        [ 266L ]        JAKE'S PROUD JAZZ 266L   DSC PHAF THF
 \tRoan, 09/04/2001, JACOB T OHLDE
  \t
connector\t3715737        [ 3S ]        IRISH PRIDE   DSP THP
 \tRoan, 05/27/1980, SHULTZ SHORTHORNS
connector\t*xAR30384        [ 245B ]        OCC JAKE'S PRIDE 245B   DSC PHAF THF
 \tRoan, 11/06/1992, JACOB T OHLDE
connector\t*sxAR30383        [ 0016 ]        OCC LUSTRE 0016  
 \tRoan, 09/05/1990, JACOB T OHLDE
connector\t*xAR32364        [ 250J ]        JAKE'S JAZZY 250J   DSP PHAF THF
 \tRed, 12/17/1999, CAL POLY
connector\tx3921311        [ 9340 ]        JG CACTUS JACK C9340   DSF
 \tRed, 07/01/1993, JETT-GARDNER POLLED SHORTHORNS
connector\tx3961998        [ 5113 ]        POLY CJ CUMBERLAND 5113 ET   DSF PHAF THF
 \tRed, 10/05/1995, CAL POLY
connector\t3821205        [ 725 ]        POLY D CUMBERLAND 725  
 \tRed & White, 09/28/1986, CAL POLY
  \t
connector\t*xAR20454        [ 091 ]        PHILDON CUNIA DIVIDEND  
 \tRed & White, 02/16/1991, PHILDON FARMS
connector\t*x3909231        [ 334 ]        CF TRUMP X   DSF PHAF THF
 \tRoan, 03/15/1993, CATES FARMS
connector\tx3881362        [ 158 ]        CF CARMELE NG NG 158X  
 \tRed w/ White Marks, 04/22/1991, CATES FARMS
connector\t*x4072518        [ 368 ]        CF SOLUTION X ET   DSF PHAF THF
 \tRed w/ White Marks, 03/19/2003, TYLER HAHN
connector\tx3989821        [ 774 ]        NPS DURANGO 774 CBH ET   DSF PHAF THF
 \tRoan, 07/30/1997, NICK STEINKE
connector\t4021066        [ 004 ]        NPS DESERT ROSE 004   PHAF THF
 \tRed & White, 03/04/2000, NICK STEINKE
connector\tx3998785        [ 833 ]        NPS DESERT ROSE 833 ET   PHAF THF
 \tRed, 04/03/1998, NICK STEINKE
Dam:  \t
*x4157771        [ 9213 ]        SULL TINA'S SOLUTION ET   DSF PHAF THF
 \tRed, 04/14/2009, JAMES SULLIVAN
  \t
connector\t*xAR20454        [ 091 ]        PHILDON CUNIA DIVIDEND  
 \tRed & White, 02/16/1991, PHILDON FARMS
connector\t*x3909231        [ 334 ]        CF TRUMP X   DSF PHAF THF
 \tRoan, 03/15/1993, CATES FARMS
connector\tx3881362        [ 158 ]        CF CARMELE NG NG 158X  
 \tRed w/ White Marks, 04/22/1991, CATES FARMS
connector\t*x4087992        [ P929 ]        SULL TINA TURNER P929   PHAF THF
 \tRed, 05/05/2004, SCOTT DRYER
connector\tx3849329        [ 8034 ]        ESQUIRE ENCORE  
 \tRoan, 07/28/1988, GREEN RIDGE SHORTHORNS
connector\tx3904731        [ H920 ]        LHS ORANGE GIRL 92X   PHAF THF
 \tRoan, 04/06/1992, LOREN M. HUNT
connector\tx3825317        [ 98H ]        LHS ORANGE LADY 85  
 \tRoan, 06/30/1985, LOREN M. HUNT
Defect Color Code meanings: \t Green - this animal has been tested and is confirmed free
 Red - this animal has been tested and is a confirmed carrier
\tDigitalBeef, LLC | PostNuke | Zikula \t
`;

