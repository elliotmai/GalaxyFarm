/**
 * Real Chianina pages, as a person copied them out of a browser.
 *
 * Checked in rather than mocked. Every rule in `parsers/chianina.ts` was written
 * against these, and against nothing else — a fixture invented to match a
 * parser proves only that the two were written by the same hand.
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

/**
 * A Chianina page whose dam's-dam block is three blanks, one animal, three
 * blanks. The blanks are the three grandparents nobody recorded, and they are
 * what says the animal in the middle is the dam's dam rather than her sire.
 */
export const CHIANINA_SPARSE_PAGE = ` Animal Detail Screen \t   \t  
Identification\t\tOther Details
 Sex:  \tBull\t Sire:  MA323178 \t CMAC HARD CORE 
 Name:  \tZNT TRIPLE X\t Dam:  303231 \t JAZX AUDREY 352N 
 Herd Prefix/Tattoo:  \t
ZNT\tLE: 503R 
 Chianina %:  \t6.44  Classification: 1CM
 Registration:  \t319149\t Genetic Makeup:  \t6.44% CA | 69.14% MA | 23.82% AN | 0.6% XX 
 International ID:  \tCIAUSAM000000319149\t  COI:  \t0%
 EID:  \t\t Service Type:  \tArtificial Insemination
 Horn/Poll/Scur: \tScurred\t Breeder:  \t(N) ZNT CATTLE CO (36694) 
 Color: \tBlack\t Owner:  \t(N) CEDAR TOP RANCH (28286) 
 \t DOB: 09/10/2005  \t Age: 20 years, 11 months, 2 days
 Status:  \tActive
tab left\tPedigree\ttab right
tab left\tDNA\ttab right
   5-Generation Pedigree   
Defect Key:  \t     Free by Test\t     Free by Pedigree\t     Suspected Carrier\t     Carrier by Test\t     Affected by Test
  \t
connector\tMA211933        CALBERTA PAYDIRT 169C         [ ]   
connector\tMA227544        RSG PAY OFF 805E MCF         [ RSG805E ]    -- PHAF THF
connector\tMA190151        MISS GLOVER 7H         [ ]   
connector\tMA291476        MCF MR DEBS GIRL PAYOFF         [ MCF23L ]    -- PHAF THF
connector\tMA132774        MR BILL 042X         [ ]   
connector\tMA195844        DEBBIES GIRL RW71C         [ ]   
connector\tMA192408        MISS DEBBIE         [ ]   
Sire:  \t
MA323178        CMAC HARD CORE         [ CMAC55N ]    -- AMS DDS NHS PHAFT THFT
  \t
connector\tMA120327        PISTOL PETE         [ JJW446V ]   
connector\t264745        FGJ HABANERO         [ FGJ9500E ]    -- AMS DDS NHS PHAFT THFT
connector\t264685        JDA MS PWR PLANT 19A 1CM         [ 19A ]    -- AMS DDS NHS
connector\tMA267938        CMAC DANDYS SAMANTHA ET         [ ]    -- AMS DDS NHS
connector\tMA135189        FR MAGIC 179X         [ GFF179X ]   
connector\tMA196960        D&D SWEET DANDY         [ ]   
connector\tMA142764        MAJORS RB SWEET CHEEKS         [ ]   
  \t
connector\t187623        TOTAL PLAY CAX         [ 75V 75V ]   
connector\t240047        WYR IMPULSE 1CA         [ 0315E ]   
connector\tAN10700901        ERICA IRENE 179 B W         [ 591 591 ]   
connector\t276412        CTR SUCCESS 02K 2CA         [ 02K ]   
connector\t188099        MOONSHINE PCA         [ 53X 53X ]   
connector\t276404        CTR STARLIGHT 5691E 1CA         [ 5691E ]   
connector\tF105540        RTC ANGUS 9396         [ ]   
Dam:  \t
303231        JAZX AUDREY 352N         [ 352N ]    -- PHAFT THFT
  \t 
 
 
connector\tC102102        JAZX MAINE ANJOU 352         [ ]   
 
 
 
\tDigitalBeef, LLC | PostNuke | Zikula \t
`;
